import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import type { Settings } from './config';
import { analyzeRoutes } from './routes/analyze';
import type { ErrorResponse, HealthResponse } from './schemas';
import { GeminiSceneAnalyzer, SceneAnalysisError, type SceneAnalyzer } from './vision';

type AppOptions = { settings: Settings; analyzer?: SceneAnalyzer };

export function createApp({ settings, analyzer = new GeminiSceneAnalyzer(settings) }: AppOptions) {
  const app = new Hono();
  app.use(logger());
  app.use(
    cors({
      origin: settings.allowedOrigins.includes('*') ? '*' : settings.allowedOrigins,
      allowMethods: ['GET', 'POST'],
    }),
  );

  app.get('/health', (c) => c.json<HealthResponse>({ status: 'ok' }));
  app.route('/api/v1', analyzeRoutes(settings, analyzer));

  // AI-ийн алдааг Монгол мессежтэй нь, бусдыг ерөнхий мессежээр буцаана.
  app.onError((error, c) => {
    if (error instanceof SceneAnalysisError) {
      return c.json<ErrorResponse>({ detail: error.detail }, error.status as ContentfulStatusCode);
    }
    console.error(error);
    return c.json<ErrorResponse>({ detail: 'Серверт алдаа гарлаа. Дахин оролдоно уу.' }, 500);
  });

  return app;
}
