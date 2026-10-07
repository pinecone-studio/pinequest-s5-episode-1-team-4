import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import type { HealthResponse } from './schemas';

export function createApp() {
  const app = new Hono();
  app.use(logger());
  app.use(cors());

  app.get('/health', (c) => c.json<HealthResponse>({ status: 'ok' }));

  return app;
}
