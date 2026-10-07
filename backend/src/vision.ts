import { GoogleGenAI, ThinkingLevel, type ThinkingConfig } from '@google/genai';

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

type GeminiClientFactory = (apiKey: string) => Pick<GoogleGenAI, 'models'>;

export class GeminiSceneAnalyzer implements SceneAnalyzer {
  constructor(
    private readonly settings: Pick<Settings, 'geminiApiKey' | 'geminiModel'>,
    private readonly createClient: GeminiClientFactory = (apiKey) => new GoogleGenAI({ apiKey }),
  ) {}

  async analyze(image: Uint8Array, mediaType: string): Promise<string> {
    const { geminiApiKey, geminiModel } = this.settings;
    if (!geminiApiKey) throw new SceneAnalysisError(503, 'GEMINI_API_KEY тохируулаагүй байна.');
    const response = await this.createClient(geminiApiKey).models.generateContent({
      model: geminiModel,
      contents: [
        { inlineData: { data: Buffer.from(image).toString('base64'), mimeType: mediaType } },
        USER_PROMPT,
      ],
      config: {
        systemInstruction: SCENE_INSTRUCTIONS,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        thinkingConfig: thinkingConfigFor(geminiModel),
        // Ачаалалтай model хэдэн арван секунд хүлээлгэдэг тул хязгаарлана.
        httpOptions: { timeout: TIMEOUT_MS },
      },
    });
    return requireDescription(response.text);
  }
}
