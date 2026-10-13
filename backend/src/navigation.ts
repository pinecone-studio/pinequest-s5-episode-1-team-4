/**
 * Явган чиглүүлэг: хэрэглэгчийн хэлсэн газрыг Чимэгэ STT-ээр бичвэр болгож, OpenStreetMap-аас
 * хайж, явган маршрутыг монгол заавар болгоно.
 * shortcut: Nominatim, routing.openstreetmap.de нь үнэгүй, хүсэлтийн хязгаартай — олон хэрэглэгчтэй
 * болбол өөрийн OSRM/Nominatim эсвэл түлхүүртэй API-д шилжинэ.
 */
const CHIMEGE_STT_URL = 'https://api.chimege.com/v1.2/transcribe';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const ROUTE_URL = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot';
// Nominatim-ийн дүрмээр User-Agent заавал байна.
const USER_AGENT = 'VisionMate/0.1 (assistive app for blind users, Mongolia)';
// Хэрэглэгчийн ойролцоо (~10 км) газрыг түрүүлж хайна.
const NEARBY_DEGREES = 0.1;

// STT товчилсон нэрийг OSM олдоггүй.
const ALIASES: Record<string, string> = {
  уид: 'Улсын их дэлгүүр',
  'их дэлгүүр': 'Улсын их дэлгүүр',
};

export type LatLon = { lat: number; lon: number };
export type Maneuver = LatLon & { announce: string; now: string };
export type Route = { distance: number; maneuvers: Maneuver[]; path: [number, number][] };

export async function transcribe(token: string, audio: Uint8Array): Promise<string> {
  const response = await fetch(CHIMEGE_STT_URL, {
    method: 'POST',
    headers: { Token: token, Punctuate: 'false', 'Content-Type': 'application/octet-stream' },
    body: audio,
    signal: AbortSignal.timeout(15_000),
  });
  // 400 — бичлэг хэт богино эсвэл дуугүй (товчийг дармагц тавьсан).
  if (response.status === 400) return '';
  if (!response.ok) throw new Error(`Chimege STT ${response.status}`);
  return (await response.text()).trim();
}

export type VoiceCommand = 'read' | 'scene' | 'walk_on' | 'walk_off';

/** Дуут тушаал. "…рүү" дагавартай бол газар руу явах хүсэлт тул null — "…рүү алхъя" ч гэсэн. */
export function voiceCommand(text: string): VoiceCommand | null {
  const said = text.toLowerCase();
  if (/(рүү|руу|лүү|луу)/.test(said)) return null;
  if (/унш/.test(said)) return 'read';
  if (/тайлбарл|орчн|юу байна|юу харагд/.test(said)) return 'scene';
  if (/алх/.test(said)) return /зогс|унтра|боль|болиул/.test(said) ? 'walk_off' : 'walk_on';
  return null;
}

/** "Улсын их дэлгүүр рүү явмаар байна" → "Улсын их дэлгүүр". */
export function extractPlace(text: string): string {
  const clean = text.replace(/[.,!?]/g, ' ').replace(/\s+/g, ' ').trim();
  const toPlace = clean.match(/^(?:би\s+)?(.+?)\s+(?:рүү|руу|лүү|луу)\S*(?:\s|$)/i)?.[1];
  // "Улсын их дэлгүүр явъя" — дагаваргүй хэлбэл төгсгөлийн үйл үгсийг хасна.
  const place = toPlace ?? clean.replace(/^би\s+/i, '').replace(/(?:\s+(?:яв|оч|хүрг|оръ|ор|оч|оръё|өг|байна|уу|үү|юм)\S*)+$/i, '');
  return ALIASES[place.toLowerCase()] ?? place;
}

export async function geocode(place: string, near: LatLon): Promise<(LatLon & { name: string }) | null> {
  const params = new URLSearchParams({
    q: place,
    format: 'json',
    limit: '1',
    countrycodes: 'mn',
    'accept-language': 'mn',
    viewbox: [near.lon - NEARBY_DEGREES, near.lat + NEARBY_DEGREES, near.lon + NEARBY_DEGREES, near.lat - NEARBY_DEGREES].join(','),
  });
  const response = await fetch(`${NOMINATIM_URL}?${params}`, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) return null;
  const [hit] = (await response.json()) as { lat: string; lon: string }[];
  return hit ? { lat: Number(hit.lat), lon: Number(hit.lon), name: place } : null;
}

const TURNS: Record<string, string> = {
  left: 'зүүн тийш',
  right: 'баруун тийш',
  'slight left': 'бага зэрэг зүүн тийш',
  'slight right': 'бага зэрэг баруун тийш',
  'sharp left': 'огцом зүүн тийш',
  'sharp right': 'огцом баруун тийш',
  uturn: 'буцаж',
};

type OsrmStep = { maneuver: { type: string; modifier?: string; location: [number, number] } };

/** Эргэлт бүрт хоёр өгүүлбэр: урьдчилан анхааруулах, яг эргэх үед. Чигээрээ явах алхмыг алгасна. */
export function toManeuvers(steps: OsrmStep[]): Maneuver[] {
  return steps.flatMap(({ maneuver: { type, modifier, location } }) => {
    const turn = modifier && TURNS[modifier];
    if (!turn || type === 'depart' || type === 'arrive') return [];
    return [{ lat: location[1], lon: location[0], announce: `50 метрийн дараа ${turn} эргэнэ.`, now: `Одоо ${turn} эргэ.` }];
  });
}

export async function walkingRoute(from: LatLon, to: LatLon): Promise<Route | null> {
  const url = `${ROUTE_URL}/${from.lon},${from.lat};${to.lon},${to.lat}?steps=true&overview=full&geometries=geojson`;
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) return null;
  const { routes } = (await response.json()) as {
    routes?: { distance: number; geometry: { coordinates: [number, number][] }; legs: { steps: OsrmStep[] }[] }[];
  };
  const route = routes?.[0];
  if (!route) return null;
  return {
    distance: route.distance,
    maneuvers: toManeuvers(route.legs.flatMap((leg) => leg.steps)),
    path: route.geometry.coordinates.map(([lon, lat]) => [lat, lon]),
  };
}

export function spokenDistance(meters: number): string {
  return meters < 1000 ? `${Math.max(10, Math.round(meters / 10) * 10)} метр` : `${(meters / 1000).toFixed(1)} километр`;
}
