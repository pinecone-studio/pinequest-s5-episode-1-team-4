import * as Haptics from 'expo-haptics';

import type { Hazard } from './api';
import { sleep } from './async';

// Зайн шатууд (м): 1-ээс ойр, 1–2, 2–3. Шат бүрт ойртоход дахин хэлж, чичирнэ.
const PROXIMITY_STEPS = [1, 2, 3];
// Машины арын мэдрэгч шиг: ойртох тусам олон, хүчтэй чичиргээ.
const PULSES = [
  { count: 3, style: Haptics.ImpactFeedbackStyle.Heavy },
  { count: 2, style: Haptics.ImpactFeedbackStyle.Medium },
  { count: 1, style: Haptics.ImpactFeedbackStyle.Light },
];
const PULSE_GAP_MS = 140;
/** Хол эсвэл зай мэдэгдэхгүй. */
export const FAR = PROXIMITY_STEPS.length;

/** 0 = 1 м-ээс ойр, 1 = 1–2 м, 2 = 2–3 м, FAR = хол. */
export function proximityLevel({ close }: Hazard): number {
  // Зай мэдэгдэхгүй үед хайрцгийн хэмжээгээр "ойрхон" гэснийг 1–2 м гэж үзнэ.
  const meters = close ? 1.5 : Infinity;
  const level = PROXIMITY_STEPS.findIndex((limit) => meters < limit);
  return level === -1 ? FAR : level;
}

export async function pulse(level: number) {
  const pattern = PULSES[level] ?? { count: 0, style: Haptics.ImpactFeedbackStyle.Light };
  for (let i = 0; i < pattern.count; i++) {
    await Haptics.impactAsync(pattern.style);
    await sleep(PULSE_GAP_MS);
  }
}
