import type { Hazard } from './api';
import { PRIORITY } from './prioritySpeaker';
import { proximityLevel } from './proximity';

// Хоёр кадрын ижил нэртэй, төв нь үүнээс ойр зүйлийг нэг зүйл гэж үзнэ. Хаалганы төв
// 0.34–0.39 хооронд хэлбэлзэж "урд"/"зүүн талд" ээлжлэн хэлэгдэж байсан.
const SAME_OBJECT_DX = 0.2;
// Үүнээс бага итгэлцэлтэйг дараалсан 2 кадрт гарсан үед л хэлнэ — гэрийн орчинд нэг
// кадрын худал илрүүлэлт олон байсан.
const CONFIDENT_SCORE = 0.7;
// Ижил зүйлийг энэ хугацаанд давтан хэлэхгүй — харин дараагийн зайн шатанд ойртвол хэлнэ.
const ALERT_REPEAT_MS = 10_000;

export const VEHICLES = new Set(['машин', 'автобус', 'ачааны машин', 'мотоцикл', 'галт тэрэг', 'дугуй']);
// Эдгээр үг орсон бол аюултай: буух шат, нүх, ирмэг, тээврийн хэрэгсэл.
export const DANGER_WORDS = /шат|гишгүүр|уруу|нүх|ирмэг|худаг|машин|автобус|мотоцикл/i;

export const sameObject = (a: Hazard, b: Hazard) => a.name === b.name && Math.abs(a.x - b.x) < SAME_OBJECT_DX;

export function hazardPriority(hazard: Hazard): number {
  const danger = VEHICLES.has(hazard.name) || DANGER_WORDS.test(hazard.name);
  return danger ? PRIORITY.danger : hazard.close ? PRIORITY.close : PRIORITY.info;
}

/** Нэг зүйлийг хэзээ хэлэхийг шийднэ: худал илрүүлэлт, давталтыг шүүнэ. */
export class AlertFilter {
  private previousFrame: Hazard[] = [];
  private last: Hazard | null = null;
  private lastAt = 0;

  shouldAlert(hazard: Hazard, now: number): boolean {
    const confirmed =
      hazard.score >= CONFIDENT_SCORE || this.previousFrame.some((seen) => sameObject(seen, hazard));
    const repeated =
      this.last !== null &&
      sameObject(this.last, hazard) &&
      proximityLevel(hazard) >= proximityLevel(this.last) &&
      now - this.lastAt <= ALERT_REPEAT_MS;
    return confirmed && !repeated;
  }

  alerted(hazard: Hazard, now: number) {
    this.last = hazard;
    this.lastAt = now;
  }

  /** Энэ кадрын зүйлс — дараагийн кадрт баталгаажуулахад хэрэглэнэ. */
  seen(hazards: Hazard[]) {
    this.previousFrame = hazards;
  }
}
