import * as Haptics from 'expo-haptics';

import { PRIORITY } from './prioritySpeaker';
import type { Phrase } from './speech';

// Машины арын мэдрэгч шиг: 1.5 м-ээс ойртох тусам чичиргээ олширно.
export const NEAR_CM = 150;
export const STOP_CM = 50;
const CLOSEST_CM = STOP_CM;
const FASTEST_PULSE_MS = 200;
const SLOWEST_PULSE_MS = 800;
// Урсгал ~10/сек, тасарвал /capture ~1/сек зай өгнө — үүнээс хуучин бол итгэлгүй.
export const SENSOR_MAX_AGE_MS = 1_500;
// Урд 2 м-т юу ч алга бол холын хүн, сандлыг хэлэхгүй — тасралтгүй ярихаа болино.
export const QUIET_BEYOND_CM = 200;
// Хэмжилт хил дээр хэлбэлзэхэд дахин дахин хэлэхгүй — энэ хэмжээгээр холдсон бол л дахин хэлнэ.
const RESET_MARGIN_CM = 30;

/** Ойртож энэ зайг давахад нэг удаа хэлнэ (ойроос хол руу). */
const STEPS: { cm: number; phrase: Phrase; text: string; priority: number }[] = [
  { cm: 50, phrase: 'obstacle-50', text: 'Зогсоорой! Урд ойрхон саад байна.', priority: PRIORITY.danger },
  { cm: 100, phrase: 'obstacle-100', text: 'Урд нэг метрт саад байна.', priority: PRIORITY.danger },
  { cm: 150, phrase: 'obstacle-150', text: 'Урд нэг метр хагаст саад байна.', priority: PRIORITY.close },
  { cm: 200, phrase: 'obstacle-200', text: 'Урд хоёр метрт саад байна.', priority: PRIORITY.close },
];

/** Хэлсэн эсвэл хэлэх шаардлагагүй бол true; илүү чухал зүйл ярьж байвал false — дахин оролдоно. */
export type SayStep = (step: { cm: number; phrase: Phrase; text: string; priority: number }) => boolean;

/** Ойртох тусам богино зай: 150 см → 800 мс, 50 см → 200 мс. */
export function pulseInterval(cm: number): number {
  const t = Math.max(0, (cm - CLOSEST_CM) / (NEAR_CM - CLOSEST_CM));
  return FASTEST_PULSE_MS + t * (SLOWEST_PULSE_MS - FASTEST_PULSE_MS);
}

/** HC-SR04-ийн зайг дуу, чичиргээ болгоно. Камерын таних ~1 сек хоцордог бол энэ ~0.1 сек. */
export class ObstacleSense {
  /** Сүүлд хэлсэн шатны зай; Infinity — юу ч хэлээгүй. */
  private spokenCm = Infinity;
  private lastPulseAt = 0;

  check(cm: number | null, now: number, say: SayStep) {
    // Зай түр ирэхгүй бол хэлсэн шатаа мартахгүй — эс бөгөөс ирэх бүрд дахин хэлнэ.
    if (cm === null) return;
    const step = STEPS.find((s) => cm < s.cm);
    const movedAway = cm > this.spokenCm + RESET_MARGIN_CM;
    if (!step) {
      if (movedAway) this.spokenCm = Infinity;
      return;
    }
    if (step.cm < this.spokenCm) {
      // Илүү чухал зүйл хэлж байвал дараагийн шалгалтаар дахин оролдоно.
      if (say(step)) {
        this.spokenCm = step.cm;
        if (step.cm === CLOSEST_CM) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }
    } else if (movedAway) {
      this.spokenCm = step.cm;
    }
    if (cm >= NEAR_CM || now - this.lastPulseAt < pulseInterval(cm)) return;
    this.lastPulseAt = now;
    void Haptics.impactAsync(cm < 100 ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Medium);
  }
}
