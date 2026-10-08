import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import { AlertAudioCache } from './alertAudio';
import type { Settings } from './config';
import { HazardDetector, type ObjectDetector } from './detector';
import { OwlVitDetector } from './openVocab';
import { detectRoutes } from './routes/detect';
import { analyzeRoutes } from './routes/analyze';
import { readRoutes } from './routes/read';
import type { ErrorResponse, HealthResponse } from './schemas';
import { ChimegeSynthesizer, type SpeechSynthesizer } from './speech';
import { GeminiSceneAnalyzer, SceneAnalysisError, type SceneAnalyzer } from './vision';
import { YoloxModel } from './yoloModel';

type AppOptions = {
  settings: Settings;
  analyzer?: SceneAnalyzer;
  speech?: SpeechSynthesizer;
  detector?: ObjectDetector;
  alertAudio?: AlertAudioCache;
};

/** YOLO (хүн, машин, тавилга) ба OWL-ViT (хаалга) зэрэг — хугацаа нь удаан нэгнийхтэй тэнцүү. */
function defaultDetector() {
  const yolo = new YoloxModel();
  return new HazardDetector([yolo, new OwlVitDetector()], yolo.available);
}

export function createApp({
  settings,
  analyzer = new GeminiSceneAnalyzer(settings),
  speech = new ChimegeSynthesizer(settings),
  detector = defaultDetector(),
  alertAudio = new AlertAudioCache(speech, `${settings.chimegeVoiceId}:${settings.chimegeSpeed}`),
}: AppOptions) {
  const app = new Hono();
  app.use(logger());
  app.use(
    cors({
      origin: settings.allowedOrigins.includes('*') ? '*' : settings.allowedOrigins,
      allowMethods: ['GET', 'POST'],
    }),
  );

  app.get('/health', (c) => c.json<HealthResponse>({ status: 'ok' }));
  app.route('/api/v1', analyzeRoutes(settings, analyzer, speech));
  app.route('/api/v1', readRoutes(settings, analyzer, speech));
  app.route('/api/v1', detectRoutes(settings, detector, alertAudio));

  // AI-ийн алдааг Монгол мессежтэй нь, бусдыг ерөнхий мессежээр буцаана.
  app.onError((error, c) => {
    if (error instanceof SceneAnalysisError) {
      return c.json<ErrorResponse>({ detail: error.detail }, error.status as ContentfulStatusCode);
    }
    console.error(error);
    return c.json<ErrorResponse>({ detail: 'Серверт алдаа гарлаа. Дахин оролдоно уу.' }, 500);
  });

  return Object.assign(app, { alertAudio });
}
