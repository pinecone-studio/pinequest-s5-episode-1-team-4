import { detectObjects } from './api';
import { PRIORITY, PrioritySpeaker } from './prioritySpeaker';
import { speakDescription } from './speech';
import type { WalkFrame } from './walkCapture';

export type WalkEvents = { onSpoken(text: string): void };

/** Алхах горимын нэг удаагийн ажиллагааны төлөв: юу хэлсэн, юу хэлж байгаа. */
export class WalkSession {
  readonly speaker = new PrioritySpeaker();
  /** Сүүлд хэлсэн өгүүлбэр — Gemini түүнийг давтахгүй. */
  previous?: string;

  constructor(private readonly events: WalkEvents) {}

  /** Нэг кадрыг шинжилж, хэлэх зүйл байвал хэлнэ. Кадрын файлуудыг устгана. */
  async inspect(frame: WalkFrame) {
    try {
      const { alert, audioBase64 } = await detectObjects(frame.uri);
      if (alert) this.say(alert, PRIORITY.close, () => speakDescription(alert, audioBase64));
    } finally {
      frame.release();
    }
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
