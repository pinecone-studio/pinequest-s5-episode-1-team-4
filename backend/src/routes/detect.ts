import { Hono } from 'hono';

import type { AlertAudioCache } from '../alertAudio';
import type { Settings } from '../config';
import type { ObjectDetector } from '../detector';
import type { Hazard } from '../hazards';
import type { DetectResponse, ErrorResponse } from '../schemas';
import { limitUploadSize, withUpload } from '../upload';

const toResponse = ({ name, direction, close, score, box }: Hazard) => ({
  name,
  direction,
  close,
  score: Number(score.toFixed(2)),
  // Апп нэг зүйлийг кадраас кадрт таньж, давтан хэлэхгүй байхад хэрэглэнэ.
  x: Number(((box[0] + box[2]) / 2).toFixed(2)),
});

/** Алхах горимын шууд сэрэмжлүүлэг: YOLO ~50 мс — Gemini-ээс 10+ дахин хурдан, хязгааргүй. */
export function detectRoutes(settings: Settings, detector: ObjectDetector, alertAudio: AlertAudioCache) {
  return new Hono().post(
    '/detect',
    limitUploadSize(settings.maxImageBytes),
    withUpload(settings.maxImageBytes, async (c, upload) => {
      if (detector.available === false) {
        return c.json<ErrorResponse>({ detail: 'YOLO model байхгүй. backend дотор `npm run download-model` ажиллуулна уу.' }, 503);
      }
      const result = await detector.detect(upload.image);
      const audio = result.alert ? await alertAudio.get(result.alert) : null;
      const found = result.hazards.slice(0, 3).map((h) => `${h.label} ${Math.round(h.score * 100)}% ${h.direction}`);
      console.log(`detect: ${Math.round(result.inferenceMs)}ms | ${found.join(', ') || 'юу ч алга'} → ${result.alert ?? '-'}`);
      return c.json<DetectResponse>({
        alert: result.alert,
        audio_base64: audio,
        hazards: result.hazards.filter((hazard) => hazard.inPath).map(toResponse),
        inference_ms: Math.round(result.inferenceMs),
      });
    }),
  );
}
