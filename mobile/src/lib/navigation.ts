import * as Location from 'expo-location';
import { File } from 'expo-file-system';

import { postForm } from './api';

export type LatLon = { lat: number; lon: number };
export type Spoken = { text: string; audio: string | null };
export type Maneuver = LatLon & { announce: Spoken; now: Spoken };
export type VoiceCommand = 'read' | 'scene' | 'walk_on' | 'walk_off';
export type NavigationPlan = {
  text: string;
  /** Горимын тушаал бол маршрутгүй ирнэ. */
  command?: VoiceCommand;
  place?: string;
  found: boolean;
  confirm?: Spoken;
  start?: Spoken;
  arrive?: Spoken;
  maneuvers?: Maneuver[];
  path?: [number, number][];
};

const NAVIGATE_TIMEOUT_MS = 30_000;
// Танхим дотор GPS байхгүй тул демод: "lat,lon" эхлэлээс маршрутын дагуу алхсан мэт байршил өгнө.
const SIMULATED_START = process.env.EXPO_PUBLIC_NAV_SIMULATE?.trim();
// Демод хурдан харагдахаар — жинхэнэ алхалт ~1.4 м/сек.
const SIMULATED_SPEED_MPS = 5;

export function distanceMeters(a: LatLon, b: LatLon): number {
  const rad = Math.PI / 180;
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.hypot(x, y) * 6_371_000;
}

/** Хэлсэн газрын бичлэгийг илгээж маршрут авна. */
export function requestRoute(audioUri: string, from: LatLon): Promise<NavigationPlan> {
  const form = new FormData();
  form.append('audio', new File(audioUri));
  form.append('lat', String(from.lat));
  form.append('lon', String(from.lon));
  return postForm<NavigationPlan>('/api/v1/navigate', form, NAVIGATE_TIMEOUT_MS);
}

export async function currentPosition(): Promise<LatLon> {
  if (SIMULATED_START) {
    const [lat, lon] = SIMULATED_START.split(',').map(Number);
    return { lat, lon };
  }
  const { granted } = await Location.requestForegroundPermissionsAsync();
  if (!granted) throw new Error('Байршлын зөвшөөрөл өгнө үү.');
  const { coords } = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  return { lat: coords.latitude, lon: coords.longitude };
}

/** Байршил өөрчлөгдөх бүрт дуудна. Буцаасан функц зогсооно. */
export function watchPosition(path: [number, number][], onPosition: (position: LatLon) => void): () => void {
  if (SIMULATED_START) return simulateWalk(path, onPosition);
  const subscription = Location.watchPositionAsync(
    { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 2 },
    ({ coords }) => onPosition({ lat: coords.latitude, lon: coords.longitude }),
  );
  return () => void subscription.then((s) => s.remove());
}

function simulateWalk(path: [number, number][], onPosition: (position: LatLon) => void): () => void {
  const points = path.map(([lat, lon]) => ({ lat, lon }));
  let index = 0;
  let position = points[0];
  const timer = setInterval(() => {
    let budget = SIMULATED_SPEED_MPS;
    while (budget > 0 && index < points.length - 1) {
      const next = points[index + 1];
      const gap = distanceMeters(position, next);
      if (gap <= budget) {
        budget -= gap;
        position = next;
        index += 1;
      } else {
        const t = budget / gap;
        position = { lat: position.lat + (next.lat - position.lat) * t, lon: position.lon + (next.lon - position.lon) * t };
        budget = 0;
      }
    }
    // Төгсгөлд хүрсэн ч байршлаа өгсөөр — "ирлээ" тасалдвал дахин оролдоно.
    onPosition(position);
  }, 1_000);
  return () => clearInterval(timer);
}
