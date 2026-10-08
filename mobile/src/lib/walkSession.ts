import * as Haptics from 'expo-haptics';

import { AlertFilter, DANGER_WORDS, hazardPriority } from './alertFilter';
import { deletePhoto, describeWhileWalking, detectObjects, type Hazard, type SceneAnalysis } from './api';
import { PRIORITY, PrioritySpeaker } from './prioritySpeaker';
import { speakDescription } from './speech';
import type { WalkFrame } from './walkCapture';

// YOLO шинэ зүйл илрүүлээгүй ч Gemini-ээр шат, тоосго зэргийг шалгах давтамж. Үнэгүй
// түвшний өдрийн хязгаар удаан алхахад дуусахгүйн тулд 6 сек.
const GEMINI_INTERVAL_MS = 6_000;
// Дүрс өөрчлөгдсөн ч Gemini-г үүнээс ойр дуудахгүй.
const GEMINI_MIN_GAP_MS = 3_000;
// Үүнээс хуучин зургийн тайлбар нь хэрэглэгч аль хэдийн өнгөрсөн зүйл байж болно.
const GEMINI_MAX_AGE_MS = 6_000;

/** Илэрсэн зүйлсийн бүрэлдэхүүн. Чиглэлгүй — хил дээрх хэлбэлзэл Gemini-г дэмий дууддаг байсан. */
const hazardKey = (hazards: Hazard[]) => [...new Set(hazards.map((hazard) => hazard.name))].sort().join('|');

const FEEDBACK: Record<number, Haptics.NotificationFeedbackType> = {
  [PRIORITY.info]: Haptics.NotificationFeedbackType.Success,
  [PRIORITY.close]: Haptics.NotificationFeedbackType.Warning,
  [PRIORITY.danger]: Haptics.NotificationFeedbackType.Warning,
};

export type WalkEvents = { onSpoken(text: string): void; isCurrent(): boolean };

/** Алхах горимын нэг удаагийн ажиллагааны төлөв: юу хэлсэн, юу хэлж байгаа. */
export class WalkSession {
  readonly speaker = new PrioritySpeaker();
  readonly filter = new AlertFilter();
  /** Хэлсэн сэрэмжлүүлгийн тоо — Gemini-ийн тайлбар хуучирсныг мэдэхэд. */
  private alertsSpoken = 0;
  private lastHazards = '';
  private lastGeminiAt = 0;
  private geminiRunning = false;
  /** Сүүлд хэлсэн өгүүлбэр — Gemini түүнийг давтахгүй. */
  previous?: string;

  constructor(private readonly events: WalkEvents) {}

  /** Нэг кадрыг шинжилж, хэлэх зүйл байвал хэлнэ. Кадрын файлуудыг устгана. */
  async inspect(frame: WalkFrame) {
    const takenAt = Date.now();
    let handedOff = false;
    try {
      const { alert, audioBase64, hazards } = await detectObjects(frame.uri);
      const top = hazards[0];
      if (top && alert) this.alertHazard(top, alert, () => speakDescription(alert, audioBase64), Date.now());
      this.filter.seen(hazards);
      handedOff = this.maybeDescribe(frame, hazards, takenAt);
    } finally {
      if (!handedOff) frame.release();
    }
  }

  /** Дүрс өөрчлөгдсөн эсвэл 6 сек өнгөрсөн бол Gemini-г YOLO-г хүлээлгэлгүй ар талд дуудна. */
  private maybeDescribe(frame: WalkFrame, hazards: Hazard[], takenAt: number): boolean {
    const key = hazardKey(hazards);
    const sinceLast = Date.now() - this.lastGeminiAt;
    const due = sinceLast > GEMINI_INTERVAL_MS || (key !== this.lastHazards && sinceLast > GEMINI_MIN_GAP_MS);
    this.lastHazards = key;
    if (this.geminiRunning || !due) return false;
    void this.describe(frame, takenAt);
    return true;
  }

  private async describe(frame: WalkFrame, takenAt: number) {
    this.geminiRunning = true;
    this.lastGeminiAt = Date.now();
    const alertsBefore = this.alertsSpoken;
    let photoUri: string | undefined;
    try {
      photoUri = await frame.detailUri();
      const result = await describeWhileWalking(photoUri, this.previous);
      if (result) await this.sayDescription(result, takenAt, alertsBefore);
    } catch {
      // Gemini ачаалалтай байсан ч YOLO-гийн сэрэмжлүүлэг үргэлжилнэ.
    } finally {
      frame.release();
      if (photoUri) deletePhoto(photoUri);
      this.geminiRunning = false;
    }
  }

  /**
   * Хэрэглэгч өнгөрсөн бол хуучин зургийн тайлбар төөрөгдүүлнэ. Энгийн тайлбарыг шинэ
   * сэрэмжлүүлэг хэлэгдсэн бол алгасна; шат, нүх зэрэг аюулыг зөвхөн хэт хуучирсан үед.
   */
  private async sayDescription({ description, audioBase64 }: SceneAnalysis, takenAt: number, alertsBefore: number) {
    const priority = DANGER_WORDS.test(description) ? PRIORITY.danger : PRIORITY.info;
    // Хэлж буй нь адил эсвэл илүү чухал бол дуусахыг хүлээнэ.
    if (priority <= this.speaker.current) await this.speaker.speaking;
    const stale =
      !this.events.isCurrent() ||
      Date.now() - takenAt > GEMINI_MAX_AGE_MS ||
      (priority < PRIORITY.danger && this.alertsSpoken !== alertsBefore);
    const spoken = !stale && this.say(description, priority, () => speakDescription(description, audioBase64));
    if (spoken) void Haptics.notificationAsync(FEEDBACK[priority]);
  }

  /** Нэг зүйлийн сэрэмжлүүлэг; илүү чухал мессеж хэлэгдэж байвал алгасна (false). */
  alertHazard(hazard: Hazard, text: string, speak: () => Promise<void>, now: number): boolean {
    const priority = hazardPriority(hazard);
    const spoken = this.filter.shouldAlert(hazard, now) && this.say(text, priority, speak);
    if (spoken) {
      this.filter.alerted(hazard, now);
      this.alertsSpoken += 1;
      void Haptics.notificationAsync(FEEDBACK[priority]);
    }
    return spoken;
  }

  say(text: string, priority: number, speak: () => Promise<void>): boolean {
    const spoken = this.speaker.speak(priority, speak);
    if (spoken) {
      this.previous = text;
      this.events.onSpoken(text);
    }
    return spoken;
  }
}
