export type Settings = {
  allowedOrigins: string[];
  maxImageBytes: number;
  geminiApiKey?: string;
  geminiModel: string;
  /** Үндсэн model ачаалалтай үед дарааллаар нь оролдох model-ууд. */
  geminiFallbackModels: string[];
  geminiWalkModel: string;
  /** Алхах горимд ээлжлэх model-ууд — хязгаар нь model тус бүрд тусдаа. */
  geminiWalkAlternates: string[];
  chimegeToken?: string;
  chimegeVoiceId: string;
  chimegeSpeed: number;
  /** COCO илрүүлэгч: yolox (2021) эсвэл rfdetr (ViT, нохой зэргийг илүү сайн олдог). */
  detector: 'yolox' | 'rfdetr';
  /** Алхах горимын нэмэлт шалгалт: gemini эсвэл local (OWLv2-оор шат, API-гүй). */
  walkAnalyzer: 'gemini' | 'local';
};

type Env = Record<string, string | undefined>;

function list(value: string | undefined, fallback: string): string[] {
  return (value?.trim() || fallback)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function loadSettings(env: Env = process.env): Settings {
  return {
    allowedOrigins: list(env.ALLOWED_ORIGINS, '*'),
    maxImageBytes: Number(env.MAX_IMAGE_BYTES?.trim() || 10 * 1024 * 1024),
    geminiApiKey: env.GEMINI_API_KEY?.trim() || undefined,
    geminiModel: env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash',
    geminiFallbackModels: list(env.GEMINI_FALLBACK_MODELS, 'gemini-3.5-flash-lite,gemini-2.5-flash'),
    geminiWalkModel: env.GEMINI_WALK_MODEL?.trim() || 'gemini-3.5-flash-lite',
    geminiWalkAlternates: list(env.GEMINI_WALK_ALTERNATES, 'gemini-3.5-flash'),
    chimegeToken: env.CHIMEGE_TOKEN?.trim() || undefined,
    chimegeVoiceId: env.CHIMEGE_VOICE_ID?.trim() || 'FEMALE3v2',
    chimegeSpeed: Number(env.CHIMEGE_SPEED?.trim() || 1),
    detector: env.DETECTOR?.trim() === 'rfdetr' ? 'rfdetr' : 'yolox',
    walkAnalyzer: env.WALK_ANALYZER?.trim() === 'local' ? 'local' : 'gemini',
  };
}
