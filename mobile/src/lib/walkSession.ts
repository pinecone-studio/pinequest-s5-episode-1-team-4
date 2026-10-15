import * as Haptics from 'expo-haptics';

import { AlertFilter, DANGER_WORDS, hazardPriority } from './alertFilter';
import { deletePhoto, describeWhileWalking, detectObjects, type Hazard, type SceneAnalysis } from './api';
import { latestDistanceCm } from './cameraStream';
import { QUIET_BEYOND_CM, SENSOR_MAX_AGE_MS } from './obstacle';
import { PRIORITY, PrioritySpeaker } from './prioritySpeaker';
import { FAR, proximityLevel, pulse } from './proximity';
import { speakDescription } from './speech';
import type { WalkFrame } from './walkCapture';

// YOLO шинэ зүйл илрүүлээгүй ч Gemini-ээр шат, тоосго зэргийг шалгах давтамж. Үнэгүй
// түвшний өдрийн хязгаар удаан алхахад дуусахгүйн тулд 6 сек.
const GEMINI_INTERVAL_MS = 6_000;
// Дүрс өөрчлөгдсөн ч Gemini-г үүнээс ойр дуудахгүй.
const GEMINI_MIN_GAP_MS = 3_000;
// Үүнээс хуучин зургийн тайлбар нь хэрэглэгч аль хэдийн өнгөрсөн зүйл байж болно. Гадаа Gemini 4–9 сек
// зарцуулдаг тул 6 сек байхад худгийн таг, кабель зэргийг бараг бүгдийг хаяж байсан.
const GEMINI_MAX_AGE_MS = 12_000;

/** Илэрсэн зүйлсийн бүрэлдэхүүн. Чиглэлгүй — хил дээрх хэлбэлзэл Gemini-г дэмий дууддаг байсан. */
const hazardKey = (hazards: Hazard[]) => [...new Set(hazards.map((hazard) => hazard.name))].sort().join('|');

// Таньсан зүйл энэ хугацаанд урд харагдсан бол мэдрэгчийн хэмжилт тэр зүйлийнх гэж үзнэ.
const NAMED_AHEAD_MS = 2_000;

// "Ажиллаж байна" гэсэн сул чичиргээний давтамж.
const HEARTBEAT_MS = 4_000;

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
  private lastHazards = '';
  private lastGeminiAt = 0;
  private geminiRunning = false;
  private lastHeartbeatAt = Date.now();
  private namedAheadAt = 0;
  /** Утсан дээр болсон зүйл — дараагийн кадартай хамт backend-ийн log руу явна. */
  private notes: string[] = [];
  /** Сүүлд хэлсэн өгүүлбэр — Gemini түүнийг давтахгүй. */
  previous?: string;

  constructor(private readonly events: WalkEvents) {}

  /** Нэг кадрыг шинжилж, хэлэх зүйл байвал хэлнэ. Кадрын файлуудыг устгана. */
  async inspect(frame: WalkFrame) {
    const takenAt = Date.now();
    let handedOff = false;
    try {
      const notes = this.notes.splice(0).join(' | ');
      const { alert, audioBase64, hazards } = await detectObjects(frame.uri, latestDistanceCm(SENSOR_MAX_AGE_MS), notes);
      const top = hazards[0];
      const alerted =
        !!top && !!alert && this.alertHazard(top, alert, () => speakDescription(alert, audioBase64), Date.now());
      this.filter.seen(hazards, Date.now());
      if (hazards.some((hazard) => hazard.direction === 'ahead')) this.namedAheadAt = Date.now();
      this.feel(hazards, alerted, Date.now());
      handedOff = this.maybeDescribe(frame, hazards, takenAt);
    } finally {
      if (!handedOff) frame.release();
    }
  }

  /**
   * Урд замын хамгийн ойрын зүйлийг кадр бүрт чичиргээгээр — яриа шиг орчны дууг дардаггүй
   * тул хүн ихтэй газар ч тохиромжтой. Чимээгүй үед горим ажиллаж байгааг сул чичиргээгээр
   * мэдрүүлнэ, эс бөгөөс гацсанаас ялгагдахгүй.
   */
  private feel(hazards: Hazard[], alerted: boolean, now: number) {
    const nearest = Math.min(FAR, ...hazards.map(proximityLevel));
    const quiet = !alerted && nearest === FAR && now - this.lastHeartbeatAt <= HEARTBEAT_MS;
    if (quiet) return;
    this.lastHeartbeatAt = now;
    if (!alerted) void (nearest < FAR ? pulse(nearest) : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft));
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
    let photoUri: string | undefined;
    try {
      photoUri = await frame.detailUri();
      const result = await describeWhileWalking(photoUri, this.previous, latestDistanceCm(SENSOR_MAX_AGE_MS));
      if (result) await this.sayDescription(result, takenAt);
    } catch {
      // Gemini ачаалалтай байсан ч YOLO-гийн сэрэмжлүүлэг үргэлжилнэ.
    } finally {
      frame.release();
      if (photoUri) deletePhoto(photoUri);
      this.geminiRunning = false;
    }
  }

  /**
   * Хэрэглэгч өнгөрсөн бол хуучин зургийн тайлбар төөрөгдүүлнэ — хэт хуучирсныг алгасна. Гудамжинд
   * машины сэрэмжлүүлэг тасралтгүй тул "шинэ сэрэмжлүүлэг хэлэгдсэн бол алгасах" нь бүх тайлбарыг хаадаг байсан.
   */
  private async sayDescription({ description, audioBase64 }: SceneAnalysis, takenAt: number) {
    const priority = DANGER_WORDS.test(description) ? PRIORITY.danger : PRIORITY.info;
    // Хэлж буй нь адил эсвэл илүү чухал бол дуусахыг хүлээнэ.
    if (priority <= this.speaker.current) await this.speaker.speaking;
    const stale = !this.events.isCurrent() || Date.now() - takenAt > GEMINI_MAX_AGE_MS;
    const spoken = !stale && this.say(description, priority, () => speakDescription(description, audioBase64));
    if (spoken) void Haptics.notificationAsync(FEEDBACK[priority]);
  }

  /** Нэг зүйлийн сэрэмжлүүлэг; илүү чухал мессеж хэлэгдэж байвал алгасна (false). */
  alertHazard(hazard: Hazard, text: string, speak: () => Promise<void>, now: number): boolean {
    const priority = hazardPriority(hazard);
    // Машин, шат зэрэг аюулыг мэдрэгчээс үл хамааран хэлнэ.
    const farAway = priority === PRIORITY.info && (latestDistanceCm(SENSOR_MAX_AGE_MS) ?? 0) > QUIET_BEYOND_CM;
    const spoken = !farAway && this.filter.shouldAlert(hazard, now) && this.say(text, priority, speak);
    if (spoken) {
      this.filter.alerted(hazard, now);
      void Haptics.notificationAsync(FEEDBACK[priority]);
    }
    return spoken;
  }

  /** Ижил мессежийг дараалан давтахгүй. */
  note(text: string) {
    if (this.notes.at(-1) !== text) this.notes.push(text);
  }

  /** Урд таньсан зүйл байвал түүнийг нэр, зайтай нь хэлнэ — мэдрэгч "саад" гэж давхар хэлэхгүй. */
  seesAhead(now: number): boolean {
    return now - this.namedAheadAt <= NAMED_AHEAD_MS;
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
