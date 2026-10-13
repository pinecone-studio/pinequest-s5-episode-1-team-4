import { Hono } from 'hono';

import type { AlertAudioCache } from '../alertAudio';
import type { Settings } from '../config';
import { extractPlace, geocode, spokenDistance, transcribe, voiceCommand, walkingRoute } from '../navigation';
import type { ErrorResponse } from '../schemas';

const MAX_AUDIO_BYTES = 2 * 1024 * 1024;

/** Дуут тушаал: горимын нэр бол түүнийг, эс бөгөөс хэлсэн газар руу явган маршрутыг буцаана. */
export function navigateRoutes(settings: Settings, alertAudio: AlertAudioCache) {
  return new Hono().post('/navigate', async (c) => {
    const fields = await c.req.parseBody();
    const audio = fields.audio instanceof File ? fields.audio : null;
    const from = { lat: Number(fields.lat), lon: Number(fields.lon) };
    if (!audio || audio.size === 0 || audio.size > MAX_AUDIO_BYTES || !Number.isFinite(from.lat) || !Number.isFinite(from.lon)) {
      return c.json<ErrorResponse>({ detail: '"audio" (2 MB хүртэл), "lat", "lon" талбарууд хэрэгтэй.' }, 422);
    }
    if (!settings.chimegeSttToken) return c.json<ErrorResponse>({ detail: 'Яриа таних тохируулаагүй байна.' }, 503);

    const say = async (text: string) => ({ text, audio: await alertAudio.get(text) });
    const started = performance.now();
    const text = await transcribe(settings.chimegeSttToken, new Uint8Array(await audio.arrayBuffer()));
    if (!text) return c.json({ text, found: false, confirm: await say('Сонсогдсонгүй. Товчийг дарж байгаад хэлнэ үү.') });
    const command = voiceCommand(text);
    if (command) {
      console.log(`voice: "${text}" → ${command}`);
      return c.json({ text, command, found: false });
    }
    const place = extractPlace(text);
    const target = place ? await geocode(place, from) : null;
    const route = target ? await walkingRoute(from, target) : null;
    console.log(`navigate: ${((performance.now() - started) / 1000).toFixed(1)}s | from ${from.lat.toFixed(5)},${from.lon.toFixed(5)} | "${text}" → ${place} → ${route ? Math.round(route.distance) + ' м' : 'олдсонгүй'}`);
    if (!route) return c.json({ text, place, found: false, confirm: await say(`${place || text} олдсонгүй. Дахин хэлнэ үү.`) });

    const distance = spokenDistance(route.distance);
    const maneuvers = await Promise.all(
      route.maneuvers.map(async (m) => ({ ...m, announce: await say(m.announce), now: await say(m.now) })),
    );
    return c.json({
      text,
      place,
      found: true,
      distance_m: Math.round(route.distance),
      confirm: await say(`${place}, ${distance}. Явах бол хоёр товшино уу.`),
      start: await say(`${place} хүртэл ${distance}. Чигээрээ алхаж эхэлнэ үү.`),
      arrive: await say('Зорьсон газартаа ирлээ.'),
      maneuvers,
      path: route.path,
    });
  });
}
