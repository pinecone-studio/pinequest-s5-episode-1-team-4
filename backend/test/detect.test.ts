import { describe, expect, it } from 'vitest';

import { AlertAudioCache } from '../src/alertAudio';
import { createApp } from '../src/app';
import { loadSettings } from '../src/config';
import { HazardDetector } from '../src/detector';
import type { Box } from '../src/yolo';

const WAV = new TextEncoder().encode('RIFF-wav');
const speech = { synthesize: async () => WAV };

function post(detector: HazardDetector) {
  const alertAudio = new AlertAudioCache(speech, 'voice', null);
  const form = new FormData();
  form.append('image', new File(['jpeg-bytes'], 'a.jpg', { type: 'image/jpeg' }));
  return createApp({ settings: loadSettings({}), speech, detector, alertAudio }).request('/api/v1/detect', {
    method: 'POST',
    body: form,
  });
}

describe('POST /api/v1/detect', () => {
  it('returns the alert, its audio and only the things in the path', async () => {
    const person = { label: 'person', score: 0.9, box: [0.4, 0.2, 0.6, 0.6] as Box };
    const sideChair = { label: 'chair', score: 0.8, box: [0.0, 0.4, 0.2, 0.6] as Box };
    const response = await post(new HazardDetector([{ detectObjects: async () => [person, sideChair] }]));

    expect(await response.json()).toEqual({
      alert: 'Урд хүн байна.',
      audio_base64: 'UklGRi13YXY=',
      hazards: [{ name: 'хүн', direction: 'ahead', close: false, score: 0.9, x: 0.5 }],
      inference_ms: expect.any(Number),
    });
  });

  it('explains how to fix a missing model', async () => {
    const response = await post(new HazardDetector([], false));

    expect(response.status).toBe(503);
    expect(((await response.json()) as { detail: string }).detail).toContain('download-model');
  });
});

describe('HazardDetector', () => {
  it('merges YOLO and OWL-ViT results and drops duplicates', async () => {
    const yolo = {
      detectObjects: async () => [
        { label: 'person', score: 0.9, box: [0.4, 0.2, 0.6, 0.6] as Box },
        { label: 'person', score: 0.6, box: [0.41, 0.21, 0.61, 0.61] as Box },
      ],
    };
    const owl = { detectObjects: async () => [{ label: 'door', score: 0.55, box: [0.7, 0.1, 0.95, 0.6] as Box }] };

    const result = await new HazardDetector([yolo, owl]).detect(new Uint8Array());

    expect(result.hazards.map((h) => h.label)).toEqual(['person', 'door']);
    expect(result.alert).toBe('Урд хүн байна.');
  });
});
