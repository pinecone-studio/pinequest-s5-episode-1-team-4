import Constants from 'expo-constants';
import { File } from 'expo-file-system';

export type SceneAnalysis = {
  description: string;
  /** Чимэгэ-ийн Монгол дуу (WAV, base64). Backend-д Чимэгэ тохируулаагүй бол null. */
  audioBase64: string | null;
};

type AnalysisPayload = { description: string | null; audio_base64?: string | null };

const SCENE_TIMEOUT_MS = 35_000;
const DEV_BACKEND_PORT = 8000;

const NETWORK_ERRORS = [
  {
    matches: (error: unknown) => error instanceof Error && error.name === 'AbortError',
    message: 'Хариу хэт удаж байна. Дахин оролдоно уу.',
  },
  {
    matches: (error: unknown) => error instanceof TypeError,
    message: 'Сервертэй холбогдож чадсангүй. Сүлжээгээ шалгана уу.',
  },
];

function getApiUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/$/, '');
  // Development-д backend нь Metro ажиллаж буй компьютер дээр байна — Wi-Fi солигдоход
  // .env засах шаардлагагүй.
  const devHost = __DEV__ ? Constants.expoConfig?.hostUri?.split(':')[0] : undefined;
  const url = configured || (devHost && `http://${devHost}:${DEV_BACKEND_PORT}`);
  if (!url) throw new Error('Серверийн хаяг тохируулаагүй байна.');
  return url;
}

function toFriendlyError(error: unknown): unknown {
  const known = NETWORK_ERRORS.find(({ matches }) => matches(error));
  return known ? new Error(known.message) : error;
}

/** Expo-ийн fetch нь `{ uri, name, type }` биш, Blob болох expo-file-system File шаардана. */
export function imageForm(imageUri: string, fields: Record<string, string> = {}): FormData {
  const form = new FormData();
  form.append('image', new File(imageUri));
  Object.entries(fields).forEach(([name, value]) => form.append(name, value));
  return form;
}

export async function postForm<T>(path: string, form: FormData, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${getApiUrl()}${path}`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload) throw new Error(payload?.detail || 'Зургийг шинжилж чадсангүй.');
    return payload as T;
  } catch (error) {
    throw toFriendlyError(error);
  } finally {
    clearTimeout(timeout);
  }
}

/** Тайлбар хоосон бол null. */
export async function describeImage(
  path: string,
  imageUri: string,
  timeoutMs: number,
  fields?: Record<string, string>,
): Promise<SceneAnalysis | null> {
  const payload = await postForm<AnalysisPayload>(path, imageForm(imageUri, fields), timeoutMs);
  const description = payload.description?.trim();
  return description ? { description, audioBase64: payload.audio_base64 || null } : null;
}

export async function requireAnalysis(result: Promise<SceneAnalysis | null>) {
  const analysis = await result;
  if (!analysis) throw new Error('Сервер хоосон хариу буцаалаа.');
  return analysis;
}

/** "Орчноо таних": зургийн 1–4 өгүүлбэр тайлбар. */
export function analyzeScene(imageUri: string): Promise<SceneAnalysis> {
  return requireAnalysis(describeImage('/api/v1/analyze', imageUri, SCENE_TIMEOUT_MS));
}

/** Илгээсэн зургийг cache-ээс устгана — зураг хуримтлагдахгүй, нууцлал хадгалагдана. */
export function deletePhoto(uri: string) {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Устгаж чадаагүй ч систем cache-ийг өөрөө цэвэрлэнэ.
  }
}
