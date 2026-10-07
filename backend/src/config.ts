export type Settings = {
  allowedOrigins: string[];
  maxImageBytes: number;
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
  };
}
