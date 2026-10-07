import { serve } from '@hono/node-server';

import { createApp } from './app';
import { loadSettings } from './config';
import { commonAlerts } from './hazards';

try {
  process.loadEnvFile();
} catch {
  // .env байхгүй бол environment-ийн утгуудыг ашиглана.
}

const port = Number(process.env.PORT ?? 8000);
const settings = loadSettings();
const app = createApp({ settings });

// Утас LAN-аар холбогдох тул бүх сүлжээний интерфэйс дээр сонсоно.
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
  console.log(`VisionMate API: http://${info.address}:${info.port}`);
});

// Түгээмэл сэрэмжлүүлгийн дууг ар талд бэлдэнэ — эхний удаа ч шууд хэлэгдэнэ.
if (settings.chimegeToken) {
  const alerts = commonAlerts();
  void app.alertAudio.prewarm(alerts).then((created) => console.log(`Сэрэмжлүүлгийн дуу: ${alerts.length} (шинээр ${created})`));
}
