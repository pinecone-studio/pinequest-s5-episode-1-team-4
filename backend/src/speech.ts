import type { Settings } from './config';
import { joinWavs } from './wav';

const CHIMEGE_BASE_URL = 'https://api.chimege.com/v1.2';
// Чимэгэ зөвхөн кирилл үсэг ба энгийн цэг таслал уншина.
const UNSUPPORTED_CHARS = /[^Ѐ-ӿ\s?!.,:;'"-]/g;
const REQUEST_TIMEOUT_MS = 15_000;
// Чимэгэ нэг хүсэлтэд дээд тал нь 200 тэмдэгт хүлээн авна.
export const MAX_CHARS_PER_REQUEST = 200;
const PARALLEL_REQUESTS = 3;

/** Хэсгүүдийг зэрэг боловсруулж, үр дүнг анхны дарааллаар нь буцаана. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Хэсгүүдийг limit-ээс хэтрүүлэхгүйгээр дарааллаар нь нийлүүлнэ. */
function pack(pieces: string[], limit: number): string[] {
  const chunks: string[] = [];
  for (const piece of pieces) {
    const joined = `${chunks.at(-1) ?? ''} ${piece}`.trim();
    if (chunks.length > 0 && joined.length <= limit) chunks[chunks.length - 1] = joined;
    else chunks.push(piece.slice(0, limit));
  }
  return chunks;
}

/** Текстийг өгүүлбэрээр, хэт урт өгүүлбэрийг үгээр нь Чимэгэ-ийн хэмжээнд хуваана. */
export function splitForTts(text: string, limit = MAX_CHARS_PER_REQUEST): string[] {
  const sentences = (text.match(/[^.!?]+[.!?]*/g) ?? []).map((s) => s.trim()).filter(Boolean);
  const pieces = sentences.flatMap((s) => (s.length <= limit ? [s] : pack(s.split(/\s+/), limit)));
  return pack(pieces, limit);
}

export type SynthesizeOptions = {
  /** Тоо, товчлолыг үг болгох алхам — зөвхөн кирилл загвар өгүүлбэрт хэрэггүй. */
  normalize?: boolean;
};

export interface SpeechSynthesizer {
  synthesize(text: string, options?: SynthesizeOptions): Promise<Uint8Array | null>;
}

type ChimegeSettings = Pick<Settings, 'chimegeToken' | 'chimegeVoiceId' | 'chimegeSpeed'>;

function speakable(text: string): string {
  return text.replace(UNSUPPORTED_CHARS, ' ').split(/\s+/).filter(Boolean).join(' ');
}

/**
 * Монгол текстийг Чимэгэ API-аар WAV болгоно. Token байхгүй эсвэл алдаа гарвал null —
 * тэр үед апп төхөөрөмжийн TTS-ээр уншина; дуугүйгээс болж тайлбар алдагдах ёсгүй.
 */
export class ChimegeSynthesizer implements SpeechSynthesizer {
  constructor(
    private readonly settings: ChimegeSettings,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async synthesize(text: string, { normalize = true }: SynthesizeOptions = {}) {
    const token = this.settings.chimegeToken;
    if (!token) return null;
    try {
      return await this.speak(token, text, normalize);
    } catch (error) {
      console.warn('Chimege TTS амжилтгүй:', error instanceof Error ? error.message : error);
      return null;
    }
  }

  private async speak(token: string, text: string, normalize: boolean) {
    const normalized = normalize ? await (await this.post(token, '/normalize-text', text)).text() : text;
    const clean = speakable(normalized);
    return clean ? this.synthesizeText(token, clean) : null;
  }

  /** Урт текстийг (жишээ нь уншсан баримт) хэсгүүдээр зэрэг үүсгэж нийлүүлнэ. */
  private async synthesizeText(token: string, text: string) {
    const parts = await mapWithConcurrency(splitForTts(text), PARALLEL_REQUESTS, (chunk) =>
      this.synthesizeChunk(token, chunk),
    );
    return joinWavs(parts);
  }

  private async synthesizeChunk(token: string, text: string) {
    const response = await this.post(token, '/synthesize', text, {
      'voice-id': this.settings.chimegeVoiceId,
      speed: String(this.settings.chimegeSpeed),
      'sample-rate': '22050',
    });
    return new Uint8Array(await response.arrayBuffer());
  }

  private async post(token: string, path: string, body: string, extra: Record<string, string> = {}) {
    const response = await this.fetchFn(`${CHIMEGE_BASE_URL}${path}`, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', Token: token, ...extra },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`${path} ${response.status}`);
    return response;
  }
}

/** API-ийн хариуд зориулсан base64 WAV, эсвэл null. */
export async function speechBase64(synthesizer: SpeechSynthesizer, text: string) {
  const audio = await synthesizer.synthesize(text);
  return audio ? Buffer.from(audio).toString('base64') : null;
}
