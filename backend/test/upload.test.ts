import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { loadSettings } from '../src/config';
import { limitUploadSize, readUpload } from '../src/upload';

const MAX = 1024;

function makeApp() {
  return new Hono().post('/upload', limitUploadSize(MAX), async (c) => {
    const upload = await readUpload(c, MAX);
    if (upload instanceof Response) return upload;
    return c.json({ bytes: upload.image.length, type: upload.mediaType });
  });
}

function post(file?: File) {
  const form = new FormData();
  if (file) form.append('image', file);
  return makeApp().request('/upload', { method: 'POST', body: form });
}

describe('readUpload', () => {
  it('accepts a JPEG photo', async () => {
    const response = await post(new File(['jpeg-bytes'], 'a.jpg', { type: 'image/jpeg' }));
    expect(await response.json()).toEqual({ bytes: 10, type: 'image/jpeg' });
  });

  it.each([
    ['no image', undefined, 422],
    ['a text file', new File(['x'], 'a.txt', { type: 'text/plain' }), 415],
    ['an empty file', new File([], 'a.jpg', { type: 'image/jpeg' }), 400],
    ['a file over the limit', new File([new Uint8Array(MAX + 1)], 'a.jpg', { type: 'image/jpeg' }), 413],
  ])('rejects %s', async (_name, file, status) => {
    const response = await post(file);
    expect(response.status).toBe(status);
    expect(((await response.json()) as { detail: string }).detail).toBeTruthy();
  });
});

describe('loadSettings', () => {
  it('uses safe defaults', () => {
    expect(loadSettings({})).toEqual({
      allowedOrigins: ['*'],
      maxImageBytes: 10 * 1024 * 1024,
      geminiModel: 'gemini-3.5-flash',
      geminiFallbackModels: ['gemini-3.5-flash-lite', 'gemini-2.5-flash'],
    });
  });

  it('reads comma-separated origins', () => {
    const settings = loadSettings({ ALLOWED_ORIGINS: 'https://a.mn, https://b.mn', MAX_IMAGE_BYTES: '2048' });
    expect(settings).toMatchObject({ allowedOrigins: ['https://a.mn', 'https://b.mn'], maxImageBytes: 2048 });
  });
});
