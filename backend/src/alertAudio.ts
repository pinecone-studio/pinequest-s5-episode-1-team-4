import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { SpeechSynthesizer } from './speech';

export const DEFAULT_CACHE_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../.cache/alert-audio');

// Чимэгэ-г ачаалахгүйн тулд урьдчилан үүсгэхдээ хүсэлт хооронд хүлээнэ.
const PREWARM_GAP_MS = 250;

/**
 * Сэрэмжлүүлгийн дууг (WAV, base64) санах ой болон диск дээр хадгална. Чимэгэ шинэ
 * өгүүлбэрт ~1 сек зарцуулдаг; "Урд хүн байна." гэх мэт олон давтагддаг өгүүлбэрийг
 * дахин үүсгэхгүй, backend дахин асахад ч алга болохгүй.
 */
export class AlertAudioCache {
  private readonly memory = new Map<string, string>();
  private readonly pending = new Map<string, Promise<string | null>>();

  constructor(
    private readonly synthesizer: SpeechSynthesizer,
    /** Хоолой, хурд солигдвол хуучин дуу ашиглагдахгүйн тулд түлхүүрт орно. */
    private readonly voiceKey: string,
    private readonly dir: string | null = DEFAULT_CACHE_DIR,
  ) {}

  async get(text: string): Promise<string | null> {
    const cached = this.memory.get(text) ?? this.readDisk(text);
    if (cached) {
      this.memory.set(text, cached);
      return cached;
    }
    return this.request(text);
  }

  /** Түгээмэл сэрэмжлүүлгүүдийг ар талд нэг нэгээр нь бэлдэнэ; шинээр үүсгэсэн тоог буцаана. */
  async prewarm(texts: string[]): Promise<number> {
    let created = 0;
    for (const text of texts.filter((t) => !this.memory.has(t) && !this.readDisk(t))) {
      created += (await this.get(text)) ? 1 : 0;
      await new Promise((resolve) => setTimeout(resolve, PREWARM_GAP_MS));
    }
    return created;
  }

  /** Ижил өгүүлбэрийг зэрэг хүссэн бол Чимэгэ-г нэг л удаа дуудна. */
  private request(text: string) {
    const request = this.pending.get(text) ?? this.synthesize(text).finally(() => this.pending.delete(text));
    this.pending.set(text, request);
    return request;
  }

  private async synthesize(text: string): Promise<string | null> {
    // Загвар өгүүлбэр зөвхөн кирилл тул normalize хэрэггүй — Чимэгэ-гийн хүсэлт хоёр дахин цөөрнө.
    const audio = await this.synthesizer.synthesize(text, { normalize: false });
    if (!audio) return null;
    const base64 = Buffer.from(audio).toString('base64');
    this.memory.set(text, base64);
    this.writeDisk(text, audio);
    return base64;
  }

  private file(text: string) {
    const hash = createHash('sha1').update(`${this.voiceKey}\n${text}`).digest('hex');
    return path.join(this.dir ?? '', `${hash}.wav`);
  }

  private readDisk(text: string): string | null {
    const file = this.file(text);
    return this.dir && existsSync(file) ? readFileSync(file).toString('base64') : null;
  }

  private writeDisk(text: string, audio: Uint8Array) {
    if (!this.dir) return;
    try {
      mkdirSync(this.dir, { recursive: true });
      writeFileSync(this.file(text), audio);
    } catch {
      // Диск рүү бичиж чадаагүй ч санах ойд байгаа тул ажиллана.
    }
  }
}
