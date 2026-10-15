import { Hono } from 'hono';

import type { AlertAudioCache } from '../alertAudio';
import type { Settings } from '../config';
import type { ObjectDetector } from '../detector';
import { toBase64, type EventHub } from '../events';
import { aheadWithDistance, type Hazard } from '../hazards';
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
export function detectRoutes(settings: Settings, detector: ObjectDetector, alertAudio: AlertAudioCache, events: EventHub) {
  return new Hono().post(
    '/detect',
    limitUploadSize(settings.maxImageBytes),
    withUpload(settings.maxImageBytes, async (c, upload) => {
      if (detector.available === false) {
        return c.json<ErrorResponse>({ detail: 'YOLO model байхгүй. backend дотор `npm run download-model` ажиллуулна уу.' }, 503);
      }
      const result = await detector.detect(upload.image);
      // Малгайн HC-SR04-ийн урдах зай (апп дамжуулна).
      const distanceCm = Number(upload.fields.distance_cm) || null;
      const measured = aheadWithDistance(result.hazards, distanceCm);
      if (measured) result.alert = measured.alert;
      const audio = result.alert ? await alertAudio.get(result.alert) : null;
      const found = result.hazards.slice(0, 3).map((h) => `${h.label} ${Math.round(h.score * 100)}% ${h.direction}`);
      if (events.watched) {
        const boxes = result.hazards.map(({ name, box, close }) => ({ name, box, close }));
        const ms = Math.round(result.inferenceMs);
        events.publish({ type: 'frame', image: toBase64(upload.image), boxes, alert: result.alert, ms, distanceCm });
      }
      const distance = distanceCm ? ` | урд ${(distanceCm / 100).toFixed(2)} м` : '';
      console.log(`detect: ${Math.round(result.inferenceMs)}ms${distance} | ${found.join(', ') || 'юу ч алга'} → ${result.alert ?? '-'}`);
      // Утас мэдрэгчийн дууг хэлсэн эсэх — log-оос шалгана.
      if (typeof upload.fields.notes === 'string' && upload.fields.notes) console.log(`  утас: ${upload.fields.notes.slice(0, 500)}`);
      return c.json<DetectResponse>({
        alert: result.alert,
        audio_base64: audio,
        // Апп зайтай зүйлийг ойртох бүрт дахин хэлнэ.
        hazards: result.hazards
          .filter((hazard) => hazard.inPath)
          .map((hazard) => ({ ...toResponse(hazard), ...(hazard === measured?.hazard && { distance_cm: distanceCm }) })),
        inference_ms: Math.round(result.inferenceMs),
      });
    }),
  );
}
