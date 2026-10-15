import { Hono } from 'hono';

import type { Settings } from '../config';
import { toBase64, type EventHub } from '../events';
import { shrinkImage } from '../images';
import type { AnalysisResponse } from '../schemas';
import { speechBase64, type SpeechSynthesizer } from '../speech';
import { limitUploadSize, withUpload } from '../upload';
import type { SceneAnalyzer } from '../vision';

// Утасны 12MP зураг удаан илгээгддэг; Gemini-д 1536px хангалттай.
const MAX_SIDE = 1536;
// Демо дэлгэцэнд жижиг хуулбар хангалттай.
const PREVIEW_SIDE = 640;
const PREVIEW_QUALITY = 70;
const JPEG_QUALITY = 80;

/** "Орчноо таних": нэг зургаас орчныг 1–4 өгүүлбэрээр тайлбарлана. */
export function analyzeRoutes(settings: Settings, analyzer: SceneAnalyzer, speech: SpeechSynthesizer, events: EventHub) {
  return new Hono().post(
    '/analyze',
    limitUploadSize(settings.maxImageBytes),
    withUpload(settings.maxImageBytes, async (c, upload) => {
      const { image, mediaType } = await shrinkImage(upload, MAX_SIDE, JPEG_QUALITY);
      const description = await analyzer.analyze(image, mediaType);
      if (events.watched) {
        const preview = await shrinkImage(upload, PREVIEW_SIDE, PREVIEW_QUALITY);
        events.publish({ type: 'speech', mode: 'scene', text: description, image: toBase64(preview.image) });
      }
      return c.json<AnalysisResponse>({ description, audio_base64: await speechBase64(speech, description) });
    }),
  );
}
