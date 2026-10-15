export type Settings = {
  allowedOrigins: string[];
  maxImageBytes: number;
  geminiApiKey?: string;
  /** Нөөц key-үүд — үнэгүй хязгаар key (project) тус бүрд тусдаа тул 429 өгвөл дараагийнх руу шилжинэ. */
  geminiApiKeys?: string[];
  geminiModel: string;
  /** Үндсэн model ачаалалтай үед дарааллаар нь оролдох model-ууд. */
  geminiFallbackModels: string[];
  geminiWalkModel: string;
  /** Алхах горимд ээлжлэх model-ууд — хязгаар нь model тус бүрд тусдаа. */
  geminiWalkAlternates: string[];
  chimegeToken?: string;
  /** Чимэгэ яриа таних (STT) — дуу үүсгэхээс тусдаа token. */
  chimegeSttToken?: string;
  chimegeVoiceId: string;
  chimegeSpeed: number;
  /** COCO илрүүлэгч: yolox (2021) эсвэл rfdetr (ViT, нохой зэргийг илүү сайн олдог). */
  detector: 'yolox' | 'rfdetr';
  /** Алхах горимын нэмэлт шалгалт: gemini эсвэл local (OWLv2-оор шат, API-гүй). */
  walkAnalyzer: 'gemini' | 'local';
  /** Демо дэлгэц: laptop backend үйл явдлаа энэ хаяг руу (Fly-ийн /api/v1/events) илгээнэ. */
  eventsRelayUrl?: string;
  /** Үйл явдал илгээх, хүлээн авах нууц үг — laptop, Fly хоёрт ижил. */
  eventsToken?: string;
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
    // GEMINI_API_KEY-д ч таслалаар хэд хэдэн key бичиж болно.
    geminiApiKey: list(env.GEMINI_API_KEY, '')[0],
    geminiApiKeys: [...list(env.GEMINI_API_KEY, '').slice(1), ...list(env.GEMINI_API_KEYS, '')],
    geminiModel: env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash',
    geminiFallbackModels: list(env.GEMINI_FALLBACK_MODELS, 'gemini-3.5-flash-lite,gemini-2.5-flash'),
    geminiWalkModel: env.GEMINI_WALK_MODEL?.trim() || 'gemini-3.5-flash-lite',
    geminiWalkAlternates: list(env.GEMINI_WALK_ALTERNATES, ''),
    chimegeToken: env.CHIMEGE_TOKEN?.trim() || undefined,
    chimegeSttToken: env.CHIMEGE_STT_TOKEN?.trim() || undefined,
    chimegeVoiceId: env.CHIMEGE_VOICE_ID?.trim() || 'FEMALE3v2',
    chimegeSpeed: Number(env.CHIMEGE_SPEED?.trim() || 1),
    detector: env.DETECTOR?.trim() === 'rfdetr' ? 'rfdetr' : 'yolox',
    walkAnalyzer: env.WALK_ANALYZER?.trim() === 'local' ? 'local' : 'gemini',
    eventsRelayUrl: env.EVENTS_RELAY_URL?.trim() || undefined,
    eventsToken: env.EVENTS_TOKEN?.trim() || undefined,
  };
}
