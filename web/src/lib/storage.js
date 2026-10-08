import { supabase } from './supabase.js';

/*
 * Image upload for item photos.
 *
 * The `item-photos` bucket is shared with staff intake. It is public and
 * configured to accept WebP only, up to 2 MB, with an anon INSERT policy and a
 * public SELECT policy — so a citizen can upload without an account and the URL
 * can be embedded straight into a report.
 *
 * Phones produce JPEG/PNG, often many megabytes, so every upload is re-encoded
 * to WebP on a canvas and downscaled until it fits. That keeps the bucket's
 * strict rules instead of widening them for every other consumer.
 *
 * Note: an uploaded photo is stored and publicly readable. Callers must tell the
 * finder that (see FoundReportForm).
 */

export const BUCKET = 'item-photos';

/** What the picker accepts, before conversion. Mirrors LostReportForm. */
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

/** Bucket hard limit is 2 MB; leave headroom for multipart framing. */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const UPLOAD_HEADROOM_BYTES = 64 * 1024;
const MAX_DIMENSION = 1600;
const WEBP_QUALITIES = [0.85, 0.7, 0.55, 0.4];
const MAX_SHRINK_ATTEMPTS = 4;

/** code: 'image-convert' | 'image-upload' */
export class StorageError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
  }
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException('Aborted', 'AbortError');
  }
}

/** Decodes to something drawable, honouring EXIF orientation where possible. */
async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Older engines reject the options object; fall back to an <img>.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () =>
        reject(new StorageError('image-convert', 'Could not read that image.'));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(
              new StorageError(
                'image-convert',
                'Could not convert that image to WebP.',
              ),
            ),
      'image/webp',
      quality,
    );
  });
}

/**
 * Re-encodes to WebP, shrinking dimensions and lowering quality until the blob
 * fits the bucket limit. Resolves to a Blob whose type is image/webp.
 *
 * Throws StorageError 'image-convert' if the browser cannot encode WebP (some
 * older Safari builds fall back to PNG) or the image stays too large.
 */
export async function prepareItemImage(file, signal) {
  throwIfAborted(signal);

  const source = await decodeImage(file);
  const sourceWidth = source.naturalWidth || source.width;
  const sourceHeight = source.naturalHeight || source.height;

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) {
    throw new StorageError(
      'image-convert',
      'Your browser could not process that image.',
    );
  }

  let scale = Math.min(1, MAX_DIMENSION / Math.max(sourceWidth, sourceHeight));

  for (let attempt = 0; attempt < MAX_SHRINK_ATTEMPTS; attempt += 1) {
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);

    for (const quality of WEBP_QUALITIES) {
      throwIfAborted(signal);
      const blob = await canvasToBlob(canvas, quality);
      if (blob.type !== 'image/webp') {
        throw new StorageError(
          'image-convert',
          'Your browser could not convert the photo to WebP. Try another browser or photo.',
        );
      }
      if (blob.size <= MAX_UPLOAD_BYTES - UPLOAD_HEADROOM_BYTES) return blob;
    }

    scale *= 0.7; // still too big — shrink and try again
  }

  throw new StorageError(
    'image-convert',
    'That photo is too detailed to upload. Please choose a smaller one.',
  );
}

function storagePath() {
  const id =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `found-reports/${id}.webp`;
}

/**
 * Converts the photo to WebP and uploads it, resolving to its public URL.
 *
 * Throws StorageError with code 'image-convert' or 'image-upload', or the
 * signal's abort reason if the caller cancels. Storage uploads cannot be
 * aborted mid-flight, so the signal is checked before and after.
 */
export async function uploadItemImage(file, signal) {
  throwIfAborted(signal);

  const blob = await prepareItemImage(file, signal);
  throwIfAborted(signal);

  const path = storagePath();
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: 'image/webp',
    cacheControl: '31536000',
    upsert: false,
  });
  if (error) throw new StorageError('image-upload', error.message);

  throwIfAborted(signal);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
