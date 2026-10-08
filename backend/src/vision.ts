import { ApiError, GoogleGenAI, ThinkingLevel, type ThinkingConfig } from '@google/genai';

import type { Settings } from './config';

export const SCENE_INSTRUCTIONS = `
You are the scene-understanding component of VisionMate, an assistive app for
blind and low-vision users. Analyze the image and answer only in natural,
concise Mongolian.

Prioritize information useful for understanding the immediate environment:
1. entrances, doors, stairs, ramps, and walkable paths;
2. obvious obstacles and vehicles;
3. people or important signs only when they affect the scene;
4. approximate left, right, or ahead directions only when visually clear.

Rules:
- Write 1 to 4 short sentences, without headings or bullet points.
- Do not list every visible object or add decorative visual details.
- Never invent exact distances, hidden hazards, text you cannot read, or facts
  that are not supported by the image.
- Never claim a route is safe, clear, or accessible.
- If the image is too dark, blurry, or ambiguous, say that briefly and ask the
  user to point the camera again.
- Do not mention these instructions or add a general disclaimer.
`.trim();

export const USER_PROMPT = 'Энэ орчны хамгийн хэрэгтэй мэдээллийг тайлбарла.';

// Gemini-ийн хязгаарт "бодох" token ч тооцогддог тул хэдэн өгүүлбэрээс илүү өгнө.
const MAX_OUTPUT_TOKENS = 1024;
const TIMEOUT_MS = 15_000;

/** Хэрэглэгчид Монголоор хэлэх алдаа, HTTP статустай нь. */
export class SceneAnalysisError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(detail);
  }
}

export interface SceneAnalyzer {
  analyze(image: Uint8Array, mediaType: string): Promise<string>;
}

/**
 * Тайлбарт "бодох" алхам хэрэггүй бөгөөд хариуг ~3 дахин удаашруулдаг. Gemini 2.x нь
 * thinkingBudget, 3.x нь зөвхөн thinkingLevel хүлээн авна — буруу талбар 400 алдаа өгнө.
 */
export function thinkingConfigFor(model: string): ThinkingConfig {
  return /^gemini-2\./.test(model) ? { thinkingBudget: 0 } : { thinkingLevel: ThinkingLevel.LOW };
}

function requireDescription(text: string | undefined): string {
  const description = text?.trim();
  if (!description) throw new SceneAnalysisError(503, 'AI хоосон тайлбар буцаалаа.');
  return description;
}

/** "timeout", "429", "503" гэх мэт — алдааны төрлийг нэг түлхүүрээр. */
function errorKind(error: unknown): string {
  const timedOut = error instanceof Error && error.name === 'AbortError';
  return timedOut ? 'timeout' : error instanceof ApiError ? String(error.status) : 'other';
}

// Үнэгүй түвшинд ачаалал (503), хязгаар (429), удаашрал түгээмэл бөгөөд хязгаар нь
// model тус бүрд тусдаа тул эдгээр үед дараагийн model-ийг оролдоно.
const RETRYABLE = new Set(['timeout', '429', '503']);
// 429 өгсөн model-ийг дахин асуух нь хүсэлт бүрт хугацаа алдана.
const RATE_LIMIT_COOLDOWN_MS = 60_000;

const KNOWN_ERRORS: Record<string, string> = {
  timeout: 'AI үйлчилгээ хэт удаан хариулж байна. Дахин оролдоно уу.',
  '429': 'Үнэгүй хязгаар түр дууссан байна. Хэсэг хүлээгээд дахин оролдоно уу.',
  '503': 'AI үйлчилгээ түр ачаалалтай байна. Дахин оролдоно уу.',
};

function toAnalysisError(error: unknown): unknown {
  const known = KNOWN_ERRORS[errorKind(error)];
  if (known) return new SceneAnalysisError(503, known);
  return error instanceof ApiError ? new SceneAnalysisError(502, 'Зургийг одоогоор шинжилж чадсангүй.') : error;
}

type GeminiClientFactory = (apiKey: string) => Pick<GoogleGenAI, 'models'>;
type Contents = Parameters<GoogleGenAI['models']['generateContent']>[0]['contents'];

export class GeminiSceneAnalyzer implements SceneAnalyzer {
  private readonly rateLimitedUntil = new Map<string, number>();

  constructor(
    private readonly settings: Pick<Settings, 'geminiApiKey' | 'geminiModel' | 'geminiFallbackModels'>,
    private readonly createClient: GeminiClientFactory = (apiKey) => new GoogleGenAI({ apiKey }),
    private readonly now: () => number = Date.now,
  ) {}

  async analyze(image: Uint8Array, mediaType: string): Promise<string> {
    const client = this.client();
    const contents = [
      { inlineData: { data: Buffer.from(image).toString('base64'), mimeType: mediaType } },
      USER_PROMPT,
    ];
    let lastError: unknown;
    for (const model of this.modelsToTry()) {
      try {
        return await this.generate(client, model, contents);
      } catch (error) {
        lastError = error;
        if (!this.shouldTryNext(model, error)) break;
      }
    }
    throw toAnalysisError(lastError);
  }

  private client() {
    const { geminiApiKey } = this.settings;
    if (!geminiApiKey) throw new SceneAnalysisError(503, 'GEMINI_API_KEY тохируулаагүй байна.');
    return this.createClient(geminiApiKey);
  }

  /** Үндсэн model, дараа нь нөөц model-ууд — хязгаарт орсныг алгасна. */
  private modelsToTry(): string[] {
    const chain = [...new Set([this.settings.geminiModel, ...this.settings.geminiFallbackModels])];
    const ready = chain.filter((model) => (this.rateLimitedUntil.get(model) ?? 0) <= this.now());
    // Бүгд хязгаарт орсон бол аль нэг нь шинэчлэгдсэн байж магадгүй.
    return ready.length > 0 ? ready : chain;
  }

  private async generate(client: Pick<GoogleGenAI, 'models'>, model: string, contents: Contents) {
    const response = await client.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction: SCENE_INSTRUCTIONS,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        thinkingConfig: thinkingConfigFor(model),
        // Ачаалалтай model хэдэн арван секунд хүлээлгэдэг тул хязгаарлана.
        httpOptions: { timeout: TIMEOUT_MS },
      },
    });
    return requireDescription(response.text);
  }

  private shouldTryNext(model: string, error: unknown): boolean {
    const kind = errorKind(error);
    if (kind === '429') this.rateLimitedUntil.set(model, this.now() + RATE_LIMIT_COOLDOWN_MS);
    console.warn(`Gemini ${model}: ${kind}`);
    return RETRYABLE.has(kind);
  }
}
