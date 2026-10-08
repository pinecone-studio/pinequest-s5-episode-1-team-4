import { Hono } from 'hono';

import type { Settings } from '../config';
import { walkingViews } from '../images';
import type { WalkResponse } from '../schemas';
import { speechBase64, type SpeechSynthesizer } from '../speech';
import { limitUploadSize, withUpload } from '../upload';
import type { SceneAnalyzer } from '../vision';
import { isNoChange, withoutDetectorObjects } from '../walkReply';

// Алхахад хурд чухал; Gemini 768px-ийн хэсгүүдээр боловсруулдаг.
const MAX_SIDE = 768;
const MAX_PREVIOUS_CHARS = 500;

/** Алхах горим: зөвхөн шинэ, чухал зүйл байвал нэг богино өгүүлбэр, үгүй бол null. */
export function walkRoutes(settings: Settings, analyzer: SceneAnalyzer, speech: SpeechSynthesizer) {
  return new Hono().post(
    '/walk',
    limitUploadSize(settings.maxImageBytes),
    withUpload(settings.maxImageBytes, async (c, upload) => {
      const previous = typeof upload.fields.previous === 'string' ? upload.fields.previous.slice(0, MAX_PREVIOUS_CHARS) : undefined;
      const started = performance.now();
      const { full, path } = await walkingViews(upload, MAX_SIDE);
      const reply = await analyzer.analyze(full.image, full.mediaType, { mode: 'walk', previous, pathCloseUp: path?.image });
      const description = isNoChange(reply) ? null : withoutDetectorObjects(reply);
      const audio = description ? await speechBase64(speech, description) : null;
      console.log(`walk: ${((performance.now() - started) / 1000).toFixed(1)}s → ${description ?? '(чимээгүй)'}`);
      return c.json<WalkResponse>({ description, audio_base64: audio });
    }),
  );
}
