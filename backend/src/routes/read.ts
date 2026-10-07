import { Hono } from 'hono';

import type { Settings } from '../config';
import { shrinkImage } from '../images';
import type { AnalysisResponse } from '../schemas';
import { speechBase64, type SpeechSynthesizer } from '../speech';
import { limitUploadSize, withUpload } from '../upload';
import type { SceneAnalyzer } from '../vision';

// Жижиг үсэг уншигдахуйц нягтралыг үлдээнэ.
const MAX_SIDE = 2048;
const JPEG_QUALITY = 85;

/** "Энийг унш": бичиг, шошго, эмийн хайрцгийг Монголоор уншина. */
export function readRoutes(settings: Settings, analyzer: SceneAnalyzer, speech: SpeechSynthesizer) {
  return new Hono().post(
    '/read',
    limitUploadSize(settings.maxImageBytes),
    withUpload(settings.maxImageBytes, async (c, upload) => {
      const { image, mediaType } = await shrinkImage(upload, MAX_SIDE, JPEG_QUALITY);
      const text = await analyzer.analyze(image, mediaType, { mode: 'read' });
      return c.json<AnalysisResponse>({ description: text, audio_base64: await speechBase64(speech, text) });
    }),
  );
}
