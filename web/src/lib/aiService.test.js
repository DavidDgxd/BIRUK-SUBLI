import { afterEach, describe, expect, it, vi } from 'vitest';
import { captionImage } from './aiService.js';

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
