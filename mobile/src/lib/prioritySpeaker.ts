/**
 * Ярианы ач холбогдол: зөвхөн илүү чухал мессеж л хэлж буйг таслана. Өмнө нь YOLO-гийн
 * "Урд сандал" Gemini-ийн "Урд шат" сэрэмжлүүлгийг дундуур нь тасалж байсан.
 */
export const PRIORITY = { info: 1, close: 2, danger: 3 } as const;

export class PrioritySpeaker {
  /** Яг хэлж буй мессежийн ач холбогдол (0 = чимээгүй). */
  current = 0;
  speaking: Promise<void> = Promise.resolve();
  private turn = 0;

  /** Хэлж буйгаас илүү чухал бол таслаж хэлнэ; үгүй бол хэлэхгүй (false). */
  speak(priority: number, speak: () => Promise<void>): boolean {
    if (priority <= this.current) return false;
    const turn = ++this.turn;
    this.current = priority;
    this.speaking = speak().finally(() => turn === this.turn && (this.current = 0));
    return true;
  }
}
