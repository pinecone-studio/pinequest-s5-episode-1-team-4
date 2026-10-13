import { describe, expect, it } from 'vitest';

import { AlertAudioCache } from '../src/alertAudio';
import { createApp } from '../src/app';
import { loadSettings } from '../src/config';
import { HazardDetector } from '../src/detector';

const speech = { synthesize: async () => new TextEncoder().encode('RIFF-wav') };

function post(env: Record<string, string>, fields: Record<string, string | File>) {
  const form = new FormData();
  Object.entries(fields).forEach(([name, value]) => form.append(name, value));
  const detector = new HazardDetector([]);
  const alertAudio = new AlertAudioCache(speech, 'voice', null);
  return createApp({ settings: loadSettings(env), speech, detector, alertAudio }).request('/api/v1/navigate', {
    method: 'POST',
    body: form,
  });
}

describe('POST /api/v1/navigate', () => {
  const audio = new File(['m4a-bytes'], 'say.m4a', { type: 'audio/mp4' });

  it('requires the recording and the position', async () => {
    expect((await post({ CHIMEGE_STT_TOKEN: 't' }, { audio })).status).toBe(422);
  });

  it('reports a missing speech-to-text token instead of failing', async () => {
    expect((await post({}, { audio, lat: '47.9', lon: '106.9' })).status).toBe(503);
  });
});
