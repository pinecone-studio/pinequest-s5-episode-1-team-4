import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { loadSettings } from '../src/config';
import { SceneAnalysisError, type SceneAnalyzer } from '../src/vision';

function post(analyzer: SceneAnalyzer, file: File) {
  const form = new FormData();
  form.append('image', file);
  return createApp({ settings: loadSettings({}), analyzer }).request('/api/v1/analyze', {
    method: 'POST',
    body: form,
  });
}

const photo = async (width: number) =>
  new File([await sharp({ create: { width, height: width / 2, channels: 3, background: '#888' } }).png().toBuffer()], 'a.png', {
    type: 'image/png',
  });

describe('POST /api/v1/analyze', () => {
  it('shrinks the photo and returns the description', async () => {
    let received: { size: number; mediaType: string } | undefined;
    const analyzer: SceneAnalyzer = {
      async analyze(image, mediaType) {
        const { width } = await sharp(image).metadata();
        received = { size: width ?? 0, mediaType };
        return 'Урд хаалга байна.';
      },
    };

    const response = await post(analyzer, await photo(3000));

    expect(await response.json()).toEqual({ description: 'Урд хаалга байна.', audio_base64: null });
    expect(received).toEqual({ size: 1536, mediaType: 'image/jpeg' });
  });

  it('passes AI errors to the user in Mongolian', async () => {
    const failing: SceneAnalyzer = {
      analyze: async () => {
        throw new SceneAnalysisError(503, 'AI үйлчилгээ түр ачаалалтай байна.');
      },
    };
    const response = await post(failing, await photo(100));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ detail: 'AI үйлчилгээ түр ачаалалтай байна.' });
  });

  it('hides unexpected errors behind a generic message', async () => {
    const broken: SceneAnalyzer = { analyze: async () => Promise.reject(new Error('boom')) };
    const response = await post(broken, await photo(100));

    expect(response.status).toBe(500);
    expect(((await response.json()) as { detail: string }).detail).toContain('Серверт алдаа');
  });
});
