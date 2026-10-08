import * as Haptics from 'expo-haptics';

import { AlertFilter, hazardPriority } from './alertFilter';
import { detectObjects, type Hazard } from './api';
import { PRIORITY, PrioritySpeaker } from './prioritySpeaker';
import { speakDescription } from './speech';
import type { WalkFrame } from './walkCapture';

const FEEDBACK: Record<number, Haptics.NotificationFeedbackType> = {
  [PRIORITY.info]: Haptics.NotificationFeedbackType.Success,
  [PRIORITY.close]: Haptics.NotificationFeedbackType.Warning,
  [PRIORITY.danger]: Haptics.NotificationFeedbackType.Warning,
};

export type WalkEvents = { onSpoken(text: string): void };

/** Алхах горимын нэг удаагийн ажиллагааны төлөв: юу хэлсэн, юу хэлж байгаа. */
export class WalkSession {
  readonly speaker = new PrioritySpeaker();
  readonly filter = new AlertFilter();
  /** Сүүлд хэлсэн өгүүлбэр — Gemini түүнийг давтахгүй. */
  previous?: string;

  constructor(private readonly events: WalkEvents) {}

  /** Нэг кадрыг шинжилж, хэлэх зүйл байвал хэлнэ. Кадрын файлуудыг устгана. */
  async inspect(frame: WalkFrame) {
    try {
      const { alert, audioBase64, hazards } = await detectObjects(frame.uri);
      const top = hazards[0];
      if (top && alert) this.alertHazard(top, alert, () => speakDescription(alert, audioBase64), Date.now());
      this.filter.seen(hazards);
    } finally {
      frame.release();
    }
  }

  /** Нэг зүйлийн сэрэмжлүүлэг; илүү чухал мессеж хэлэгдэж байвал алгасна (false). */
  alertHazard(hazard: Hazard, text: string, speak: () => Promise<void>, now: number): boolean {
    const priority = hazardPriority(hazard);
    const spoken = this.filter.shouldAlert(hazard, now) && this.say(text, priority, speak);
    if (spoken) {
      this.filter.alerted(hazard, now);
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
