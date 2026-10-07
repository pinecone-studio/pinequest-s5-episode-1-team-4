import { Hono } from 'hono';

import type { Settings } from '../config';
import { shrinkImage } from '../images';
import type { AnalysisResponse } from '../schemas';
import { limitUploadSize, withUpload } from '../upload';
import type { SceneAnalyzer } from '../vision';

// Утасны 12MP зураг удаан илгээгддэг; Gemini-д 1536px хангалттай.
const MAX_SIDE = 1536;
const JPEG_QUALITY = 80;

/** "Орчноо таних": нэг зургаас орчныг 1–4 өгүүлбэрээр тайлбарлана. */
export function analyzeRoutes(settings: Settings, analyzer: SceneAnalyzer) {
  return new Hono().post(
    '/analyze',
    limitUploadSize(settings.maxImageBytes),
    withUpload(settings.maxImageBytes, async (c, upload) => {
      const { image, mediaType } = await shrinkImage(upload, MAX_SIDE, JPEG_QUALITY);
      const description = await analyzer.analyze(image, mediaType);
      return c.json<AnalysisResponse>({ description, audio_base64: null });
    }),
  );
}
