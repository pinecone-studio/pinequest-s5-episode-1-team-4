import { serve } from '@hono/node-server';

import { createApp } from './app';
import { loadSettings } from './config';

try {
  process.loadEnvFile();
} catch {
  // .env байхгүй бол environment-ийн утгуудыг ашиглана.
}

const port = Number(process.env.PORT ?? 8000);

// Утас LAN-аар холбогдох тул бүх сүлжээний интерфэйс дээр сонсоно.
serve({ fetch: createApp({ settings: loadSettings() }).fetch, port, hostname: '0.0.0.0' }, (info) => {
  console.log(`VisionMate API: http://${info.address}:${info.port}`);
});
