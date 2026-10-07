import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import type { Settings } from './config';
import type { HealthResponse } from './schemas';

type AppOptions = { settings: Settings };

export function createApp({ settings }: AppOptions) {
  const app = new Hono();
  app.use(logger());
  app.use(
    cors({
      origin: settings.allowedOrigins.includes('*') ? '*' : settings.allowedOrigins,
      allowMethods: ['GET', 'POST'],
    }),
  );

  app.get('/health', (c) => c.json<HealthResponse>({ status: 'ok' }));

  return app;
}
