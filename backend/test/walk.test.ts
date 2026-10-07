import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { loadSettings } from '../src/config';
import type { AnalysisRequest } from '../src/vision';

async function walk(reply: string, previous?: string) {
  const requests: AnalysisRequest[] = [];
  const analyzer = { analyze: async (_i: Uint8Array, _t: string, request?: AnalysisRequest) => (requests.push(request!), reply) };
  const speech = { synthesize: async () => new TextEncoder().encode('RIFF-wav') };
  const photo = await sharp({ create: { width: 1200, height: 1600, channels: 3, background: '#888' } }).jpeg().toBuffer();
  const form = new FormData();
  form.append('image', new File([photo], 'a.jpg', { type: 'image/jpeg' }));
  if (previous) form.append('previous', previous);
  const response = await createApp({ settings: loadSettings({}), analyzer, speech }).request('/api/v1/walk', { method: 'POST', body: form });
  const body = (await response.json()) as { description: string | null; audio_base64: string | null };
  return { body, request: requests[0] };
}

describe('POST /api/v1/walk', () => {
  it('speaks a new short warning and sends the path close-up', async () => {
    const { body, request } = await walk('Урд шат байна.', 'Зүүн талд машин байна.');

    expect(body).toEqual({ description: 'Урд шат байна.', audio_base64: 'UklGRi13YXY=' });
    expect(request.previous).toBe('Зүүн талд машин байна.');
    expect((await sharp(request.pathCloseUp!).metadata()).width).toBeLessThanOrEqual(768);
  });

  it.each(['-', ' - ', '—', '-.'])('stays silent when the model replies %j', async (reply) => {
    expect((await walk(reply)).body).toEqual({ description: null, audio_base64: null });
  });

  it.each([
    ['Урд хаалга байна.', null],
    ['Баруун талд сандал байна. Урд уруудах шат байна.', 'Урд уруудах шат байна.'],
    ['Урд машин ирж байна.', 'Урд машин ирж байна.'],
    ['Урд хүнд төмөр хайрцаг байна.', 'Урд хүнд төмөр хайрцаг байна.'],
  ])('drops what the fast detector already announces: %j', async (reply, expected) => {
    expect((await walk(reply)).body.description).toBe(expected);
  });
});
