export type Settings = {
  allowedOrigins: string[];
  maxImageBytes: number;
  geminiApiKey?: string;
  geminiModel: string;
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
  };
}
