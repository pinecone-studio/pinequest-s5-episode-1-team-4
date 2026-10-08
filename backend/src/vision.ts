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

/** Алхах горимд шинэ зүйл алга бол model яг энэ тэмдгийг буцаана. */
export const NO_CHANGE = '-';

export const WALK_INSTRUCTIONS = `
You are the walking-mode component of VisionMate, an assistive app for blind and
low-vision users. The user is walking and the phone camera points forward. You
receive one frame every few seconds.

Answer in natural Mongolian with at most ONE short sentence (about 10 words)
about the single most important thing for walking right now, in this order:
1. anything on the ground in the path that could trip the user, even small:
   bricks, stones, sticks, wood, branches, cables, boxes, bags, bottles;
   also steps, stairs, curbs, holes, and open manholes;
2. vehicles, bicycles, or people directly ahead;
3. doors, entrances, crossings, or the path turning.

Another fast system already announces people, vehicles, animals, doors and
furniture (chairs, tables, sofas, beds). Never mention any of those — it gives
their direction more reliably. Your job is only what that system cannot see:
steps, stairs (especially stairs going down), curbs, holes, open manholes, and
small things on the ground that could trip the user. Ignore objects
on tables, shelves or walls, and paper or small clutter that will not trip
anyone. Use simple, everyday Mongolian words.

You may receive a second image: a close-up of the walking path cut from the
lower center of the same photo. Check it carefully for small objects on the
ground — they are easy to miss in the full frame.

The user hears your answer a few seconds after the photo was taken, so things at
the far left or right edge are usually already behind them. Focus on the walking
path straight ahead (center and lower center of the frame) that the user will
reach soon. Mention something at the side only if it is a door or entrance.

Rules:
- Use only "урд", "зүүн талд", "баруун талд" for direction, decided from the
  first (full) image: its left half is the user's left. If unsure, say "урд".
- Never give distances and never say the path is safe, clear, or free.
- Do not describe colors, weather, or decorative details.
- If nothing important is visible, or the previous message already covers what
  matters and nothing important changed, reply with exactly: ${NO_CHANGE}
- If the image is too dark or blurry to judge, reply with exactly: ${NO_CHANGE}
`.trim();

export const READ_INSTRUCTIONS = `
You are the reading component of VisionMate, an assistive app for blind and
low-vision users. The user pointed the camera at text (a document, sign, label,
package, screen, or medicine box) and wants it read aloud.

Your answer is spoken by a Mongolian text-to-speech engine that can only read
Mongolian Cyrillic, so:
- Mongolian text: copy it exactly, in natural reading order.
- Only when most of the text is in another language: translate it into
  Mongolian and start with the language, e.g. "Англи хэл дээрх бичиг:". A few
  Latin-letter brand names inside Mongolian text do not count.
- Write brand names, abbreviations and other Latin-letter words in Cyrillic as
  they are pronounced, e.g. Paracetamol → Парацетамол.
- Keep numbers, dates, prices, phone numbers and dosages exact, written as digits.

Rules:
- Output plain text only: no headings, markdown, bullet symbols or emoji.
- Packages and medicine: start with the product name, then dosage, expiry date
  and warnings if visible.
- Long documents: read the title and the main text; skip page numbers, barcodes
  and repeated headers.
- Never guess unreadable text. If part is cut off or blurry, say so briefly at
  the end, e.g. "Доод хэсэг нь бүдэг байна."
- If there is no readable text, reply exactly:
  "Унших бичиг олдсонгүй. Камераа бичиг рүү ойртуулна уу."
`.trim();

export const READ_PROMPT = 'Энэ зураг дээрх бичгийг уншиж өг.';

const PATH_CLOSE_UP_LABEL = 'Ижил зургийн явах замын хэсгийг томруулсан:';

export type AnalysisMode = 'scene' | 'read' | 'walk';

export type AnalysisRequest = {
  mode: AnalysisMode;
  /** Алхах горимд өмнө нь хэлсэн тайлбар — давтахгүйн тулд. */
  previous?: string;
  /** Алхах горимд явах замын томруулсан хэсэг (JPEG). */
  pathCloseUp?: Uint8Array;
};

const walkPrompt = ({ previous }: AnalysisRequest) =>
  previous?.trim()
    ? `Өмнөх мессеж: "${previous.trim()}". Одоо хамгийн чухал зүйл юу вэ?`
    : 'Одоо хамгийн чухал зүйл юу вэ?';

// Gemini-ийн хязгаарт "бодох" token ч тооцогддог; уншлагад урт текст гарна. Алхахад
// хоцорсон хариу хэрэггүй ч Gemini 10 сек-ээс богино хугацаа хүлээн авдаггүй.
const PROMPTS: Record<AnalysisMode, Prompt> = {
  scene: { instructions: SCENE_INSTRUCTIONS, userPrompt: () => USER_PROMPT, maxTokens: 1024, timeoutMs: 15_000 },
  read: { instructions: READ_INSTRUCTIONS, userPrompt: () => READ_PROMPT, maxTokens: 4096, timeoutMs: 20_000 },
  walk: { instructions: WALK_INSTRUCTIONS, userPrompt: walkPrompt, maxTokens: 1024, timeoutMs: 10_000 },
};
type Prompt = {
  instructions: string;
  userPrompt: (request: AnalysisRequest) => string;
  maxTokens: number;
  timeoutMs: number;
};

const inline = (data: Uint8Array, mimeType: string) => ({ inlineData: { data: Buffer.from(data).toString('base64'), mimeType } });

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
  analyze(image: Uint8Array, mediaType: string, request?: AnalysisRequest): Promise<string>;
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
  private walkTurn = 0;

  constructor(
    private readonly settings: Pick<
      Settings,
      'geminiApiKey' | 'geminiModel' | 'geminiFallbackModels' | 'geminiWalkModel' | 'geminiWalkAlternates'
    >,
    private readonly createClient: GeminiClientFactory = (apiKey) => new GoogleGenAI({ apiKey }),
    private readonly now: () => number = Date.now,
  ) {}

  async analyze(image: Uint8Array, mediaType: string, request: AnalysisRequest = { mode: 'scene' }): Promise<string> {
    const client = this.client();
    const prompt = PROMPTS[request.mode];
    const closeUp = request.pathCloseUp ? [PATH_CLOSE_UP_LABEL, inline(request.pathCloseUp, 'image/jpeg')] : [];
    const contents = [inline(image, mediaType), ...closeUp, prompt.userPrompt(request)];
    let lastError: unknown;
    for (const model of this.modelsToTry(request.mode)) {
      try {
        return await this.generate(client, model, contents, prompt);
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
  private modelsToTry(mode: AnalysisMode): string[] {
    const { geminiModel, geminiFallbackModels, geminiWalkModel, geminiWalkAlternates } = this.settings;
    // Алхахад хурд чухал тул хөнгөн model-уудыг ээлжилнэ — үнэгүй хязгаар нь model тус бүрд тусдаа.
    const walkModels = [geminiWalkModel, ...geminiWalkAlternates];
    const walkFirst = mode === 'walk' ? [walkModels[this.walkTurn++ % walkModels.length], ...walkModels] : [];
    const chain = [...new Set([...walkFirst, geminiModel, ...geminiFallbackModels])];
    const ready = chain.filter((model) => (this.rateLimitedUntil.get(model) ?? 0) <= this.now());
    // Бүгд хязгаарт орсон бол аль нэг нь шинэчлэгдсэн байж магадгүй.
    return ready.length > 0 ? ready : chain;
  }

  private async generate(
    client: Pick<GoogleGenAI, 'models'>,
    model: string,
    contents: Contents,
    { instructions, maxTokens, timeoutMs }: Prompt,
  ) {
    const response = await client.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction: instructions,
        maxOutputTokens: maxTokens,
        thinkingConfig: thinkingConfigFor(model),
        // Ачаалалтай model хэдэн арван секунд хүлээлгэдэг тул хязгаарлана.
        httpOptions: { timeout: timeoutMs },
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
