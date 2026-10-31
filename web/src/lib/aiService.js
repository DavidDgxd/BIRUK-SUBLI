/*
 * Client for the FastAPI CLIP microservice (ai-service/main.py).
 *
 *   POST {BASE}/embed/text   form field "text"  -> { "vector": number[512], "dim": 512 }
 *   POST {BASE}/embed/image  form field "file"  -> { "vector": number[512], "dim": 512 }
 *   POST {BASE}/caption/image form field "file" -> { "caption": string }
 *
 * A rejected call answers {"detail": "..."} with 422 (blank or over-long text)
 * or 503 (the model failed); postForJson surfaces that sentence to the user.
 *
 * The service does not translate yet. If it later returns "translated_text" from
 * /embed/text, the results page shows it to the user.
 *
 * Set VITE_AI_SERVICE_URL in web/.env to override the service location.
 * Otherwise the service is assumed to run on the same host that served this
 * page, port 8000 — so a phone opening the LAN address hits the dev machine
 * rather than its own loopback.
 */

const AI_SERVICE_PORT = 8000;

/** Host names that mean "this very machine" to whichever browser runs this. */
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$/i;

function isLoopbackUrl(url) {
  try {
    return LOOPBACK_HOST.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Where the FastAPI service lives, as seen from this browser.
 *
 * "localhost" resolves to whoever runs the browser, so a phone opening
 * http://192.168.x.x:5173 would otherwise call its own loopback interface. When
 * the page is served from a LAN host, target that same host on the AI port.
 *
 * A VITE_AI_SERVICE_URL naming a real (non-loopback) host still wins, so a
 * deployed or tunnelled service overrides the dev default — but a loopback URL
 * from .env does not defeat the LAN case above.
 */
function resolveBaseUrl() {
  const configured = import.meta.env.VITE_AI_SERVICE_URL;
  const pageHost =
    typeof window !== 'undefined' ? window.location.hostname : '';

  if (
    configured &&
    (!isLoopbackUrl(configured) || LOOPBACK_HOST.test(pageHost))
  ) {
    return configured;
  }
  return `http://${pageHost || 'localhost'}:${AI_SERVICE_PORT}`;
}

const BASE_URL = resolveBaseUrl().replace(/\/$/, '');

export const EMBEDDING_DIM = 512;

/**
 * Longest description sent to POST /embed/text. Mirrors MAX_TEXT_LENGTH in
 * ai-service/main.py: the public search box caps typing at 200 characters, but
 * the report and staff-intake flows caption a photo with several fields joined
 * together, which runs longer.
 */
export const MAX_EMBED_TEXT_LENGTH = 1000;

/** code: 'ai-unreachable' | 'ai-failed' | 'ai-bad-response' | 'db' */
export class SearchError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SearchError';
    this.code = code;
  }
}

/**
 * Readable reason for a rejected embedding call.
 *
 * The service answers a bad request with {"detail": "..."} (FastAPI's shape for
 * both HTTPException and validation errors). That sentence — "Describe the item
 * you are looking for in a few words." — is far more use to a user than the
 * bare status code, so it is preferred and the status is kept as a fallback.
 */
async function failureMessage(response, path) {
  const fallback = `AI service returned ${response.status} for ${path}`;
  try {
    const body = await response.json();
    const detail = body?.detail;
    if (typeof detail === 'string' && detail.trim()) return detail;
    // Validation errors arrive as a list of {loc, msg, type} objects.
    if (Array.isArray(detail) && typeof detail[0]?.msg === 'string') {
      return detail[0].msg;
    }
  } catch {
    // Not JSON (a proxy error page, say) — the status code is all we have.
  }
  return fallback;
}

async function postForJson(path, init, signal) {
  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      signal,
      ...init,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new SearchError(
      'ai-unreachable',
      `Could not reach the AI service at ${BASE_URL}`,
    );
  }

  if (!response.ok) {
    throw new SearchError('ai-failed', await failureMessage(response, path));
  }

  try {
    return await response.json();
  } catch {
    throw new SearchError(
      'ai-bad-response',
      `AI service sent invalid JSON for ${path}`,
    );
  }
}

async function postForEmbedding(path, init, signal) {
  const body = await postForJson(path, init, signal);

  if (!Array.isArray(body.vector) || body.vector.length !== EMBEDDING_DIM) {
    throw new SearchError(
      'ai-bad-response',
      `Expected a ${EMBEDDING_DIM}-number "vector" from ${path}`,
    );
  }
  return body;
}

/**
 * Embeds a typed description via POST /embed/text (US-11).
 *
 * The caller may type freely — a phrase, a sentence, English or Filipino — and
 * does not need to name a category or tag. Blank input is rejected here rather
 * than at the service: an empty description still encodes to a meaningless
 * vector that scores close to every item, so the search would "succeed" while
 * showing arbitrary results.
 */
export async function embedText(text, signal) {
  const clean = (text ?? '').trim();

  if (!clean) {
    throw new SearchError(
      'ai-failed',
      'Describe the item you are looking for in a few words.',
    );
  }
  if (clean.length > MAX_EMBED_TEXT_LENGTH) {
    throw new SearchError(
      'ai-failed',
      `Description is too long. Keep it under ${MAX_EMBED_TEXT_LENGTH} characters.`,
    );
  }

  const form = new FormData();
  form.append('text', clean);
  const body = await postForEmbedding('/embed/text', { body: form }, signal);
  return {
    embedding: body.vector,
    translatedText: body.translated_text ?? null,
  };
}

export async function embedImage(file, signal) {
  const form = new FormData();
  form.append('file', file);
  const body = await postForEmbedding('/embed/image', { body: form }, signal);
  return { embedding: body.vector };
}

/**
 * Suggests a short description for a newly logged photo (US-5).
 *
 * The returned caption is only a starting point: staff confirm or edit it in
 * the intake form before the record is filed. It is never written to the public
 * title automatically.
 */
export async function captionImage(file, signal) {
  const form = new FormData();
  form.append('file', file);
  const body = await postForJson('/caption/image', { body: form }, signal);

  if (typeof body.caption !== 'string' || !body.caption.trim()) {
    throw new SearchError(
      'ai-bad-response',
      'Expected a non-empty "caption" from /caption/image',
    );
  }

  return { caption: body.caption.trim(), model: body.model ?? null };
}

/**
 * Best-effort captioning for callers that must never block on the AI service.
 * Resolves to the caption text, or null when the photo cannot be described.
 * A genuine cancel — the caller's own signal — still propagates.
 */
export async function captionImageOrNull(
  file,
  signal,
  { timeoutMs = 20000, label = 'aiService' } = {},
) {
  const controller = new AbortController();
  const timer = setTimeout(
    () =>
      controller.abort(
        new DOMException('Photo captioning timed out', 'TimeoutError'),
      ),
    timeoutMs,
  );
  const forwardAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', forwardAbort, { once: true });
  }

  try {
    const { caption } = await captionImage(file, controller.signal);
    return caption;
  } catch (error) {
    if (signal?.aborted) throw error;
    if (import.meta.env.DEV) {
      console.warn(`[${label}] photo captioning failed:`, error.message);
    }
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

/**
 * Best-effort photo embedding: resolves to the vector, or null when the photo
 * half cannot help.
 *
 * Any photo-side problem (unreachable service, bad response, timeout) drops the
 * caller back to matching on text alone rather than blocking the submission. A
 * genuine cancel — the caller's own signal — propagates instead.
 *
 * Shared by the lost, found and staff-intake flows so the timeout/abort handling
 * lives in one place; `label` only tags the development warning.
 */
export async function embedImageOrNull(
  file,
  signal,
  { timeoutMs = 8000, label = 'aiService' } = {},
) {
  const controller = new AbortController();
  const timer = setTimeout(
    () =>
      controller.abort(
        new DOMException('Photo embedding timed out', 'TimeoutError'),
      ),
    timeoutMs,
  );
  const forwardAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', forwardAbort, { once: true });
  }

  try {
    const { embedding } = await embedImage(file, controller.signal);
    return embedding;
  } catch (error) {
    if (signal?.aborted) throw error;
    if (import.meta.env.DEV) {
      console.warn(
        `[${label}] photo embedding failed, matching on text only:`,
        error.message,
      );
    }
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}
