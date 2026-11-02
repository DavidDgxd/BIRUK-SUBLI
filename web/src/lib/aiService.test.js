import { afterEach, describe, expect, it, vi } from 'vitest';
import { captionImage, captionImageFromUrlOrNull } from './aiService.js';

function response(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
  };
}

function photo() {
  return new Blob(['photo'], { type: 'image/png' });
}

function imageResponse(blob, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    blob: vi.fn().mockResolvedValue(blob),
  };
}

describe('captionImage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the photo and returns the trimmed caption', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        response({ caption: '  A brown leather wallet.  ', model: 'blip' }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await captionImage(photo());

    expect(result).toEqual({
      caption: 'A brown leather wallet.',
      model: 'blip',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:8000/caption/image');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.body.get('file')).toBeInstanceOf(Blob);
  });

  it('rejects a response without a usable caption', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(response({ caption: '   ' })),
    );

    await expect(captionImage(photo())).rejects.toMatchObject({
      name: 'SearchError',
      code: 'ai-bad-response',
    });
  });

  it('surfaces the service detail when captioning fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        response(
          { detail: 'Could not describe that photo: model offline' },
          { ok: false, status: 503 },
        ),
      ),
    );

    await expect(captionImage(photo())).rejects.toMatchObject({
      name: 'SearchError',
      code: 'ai-failed',
      message: 'Could not describe that photo: model offline',
    });
  });
});

describe('captionImageFromUrlOrNull', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches a reused report photo and captions the blob', async () => {
    const blob = photo();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(imageResponse(blob))
      .mockResolvedValueOnce(response({ caption: 'A black umbrella.' }));
    vi.stubGlobal('fetch', fetchMock);

    const url = 'https://example.test/found-reports/original.webp';
    const result = await captionImageFromUrlOrNull(url);

    expect(result).toBe('A black umbrella.');
    expect(fetchMock.mock.calls[0][0]).toBe(url);
    expect(fetchMock.mock.calls[1][0]).toBe(
      'http://localhost:8000/caption/image',
    );
    const posted = fetchMock.mock.calls[1][1].body.get('file');
    expect(posted.type).toBe(blob.type);
    expect(posted.size).toBe(blob.size);
  });

  it('returns null when the reused photo cannot be fetched', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(imageResponse(photo(), { ok: false, status: 404 })),
    );

    await expect(
      captionImageFromUrlOrNull('https://example.test/missing.webp'),
    ).resolves.toBeNull();
  });

  it('returns null when the caption endpoint fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(imageResponse(photo()))
        .mockResolvedValueOnce(
          response({ detail: 'model offline' }, { ok: false, status: 503 }),
        ),
    );

    await expect(
      captionImageFromUrlOrNull('https://example.test/report.webp'),
    ).resolves.toBeNull();
  });
});
