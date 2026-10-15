import { describe, expect, it } from 'vitest';

import { AlertAudioCache } from '../src/alertAudio';
import { createApp } from '../src/app';
import { loadSettings } from '../src/config';
import { HazardDetector } from '../src/detector';
import { toDetections } from '../src/openVocab';
import type { Box } from '../src/yolo';

const WAV = new TextEncoder().encode('RIFF-wav');
const speech = { synthesize: async () => WAV };

function post(detector: HazardDetector, distanceCm?: string) {
  const alertAudio = new AlertAudioCache(speech, 'voice', null);
  const form = new FormData();
  form.append('image', new File(['jpeg-bytes'], 'a.jpg', { type: 'image/jpeg' }));
  if (distanceCm) form.append('distance_cm', distanceCm);
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

  it('names the thing ahead with the distance the hat sensor measured', async () => {
    const person = { label: 'person', score: 0.9, box: [0.4, 0.2, 0.6, 0.6] as Box };
    const response = await post(new HazardDetector([{ detectObjects: async () => [person] }]), '145');

    expect(await response.json()).toMatchObject({
      alert: 'Урд нэг метр хагаст хүн байна.',
      hazards: [{ name: 'хүн', distance_cm: 145 }],
    });
  });

  it('does not give the sensor distance to something beside its beam', async () => {
    const person = { label: 'person', score: 0.9, box: [0.3, 0.2, 0.42, 0.6] as Box };
    const response = await post(new HazardDetector([{ detectObjects: async () => [person] }]), '145');

    expect(((await response.json()) as { alert: string }).alert).toBe('Урд хүн байна.');
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

describe('OWL-ViT doors', () => {
  const box = (xmin: number) => ({ xmin, ymin: 0.1, xmax: xmin + 0.3, ymax: 0.9 });

  it('drops a door that looks more like a fire extinguisher cabinet', () => {
    const doors = toDetections([
      { label: 'a door', score: 0.6, box: box(0.3) },
      { label: 'a fire extinguisher cabinet', score: 0.7, box: box(0.32) },
      { label: 'a door', score: 0.5, box: box(0.65) },
      { label: 'a cabinet', score: 0.4, box: box(0.65) },
    ]);
    expect(doors.map((d) => [d.label, d.score])).toEqual([['door', 0.5]]);
  });

  it('names a desk as a table', () => {
    expect(toDetections([{ label: 'a desk', score: 0.45, box: box(0.3) }]).map((d) => d.label)).toEqual(['dining table']);
  });
});
