import { File, Paths } from 'expo-file-system';

import { deletePhoto } from './api';
import type { FrameSource } from './walkCapture';

// Камер утасны hotspot-д холбогдож, mDNS нэрээр олдоно. Олдохгүй бол .env-д IP-г бичнэ.
const DEFAULT_CAMERA_URL = 'http://visionmate-cam.local';
// 640px кадр Wi-Fi-аар ~0.1 сек; 1600px тод кадр ба хэмжээ солих нь удаан.
const CAPTURE_TIMEOUT_MS = 4_000;
const HI_RES_TIMEOUT_MS = 8_000;
const HEALTH_TIMEOUT_MS = 2_000;

let sequence = 0;

export function getCameraUrl(): string {
  return process.env.EXPO_PUBLIC_CAMERA_URL?.trim().replace(/\/$/, '') || DEFAULT_CAMERA_URL;
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/** Камер асаалттай, ижил сүлжээнд байгаа эсэх. */
export async function isCameraReachable(): Promise<boolean> {
  try {
    return (await fetchWithTimeout(`${getCameraUrl()}/health`, HEALTH_TIMEOUT_MS)).ok;
  } catch {
    return false;
  }
}

/**
 * Камераас нэг JPEG авч cache-д хадгална. `hiRes` — бичиг уншихад 1600x1200.
 * Дуудагч нь deletePhoto-оор устгана.
 */
export async function captureJpeg(hiRes = false): Promise<string> {
  const url = `${getCameraUrl()}/capture${hiRes ? '?size=hi' : ''}`;
  const response = await fetchWithTimeout(url, hiRes ? HI_RES_TIMEOUT_MS : CAPTURE_TIMEOUT_MS).catch(() => {
    throw new Error('Камертай холбогдож чадсангүй. Камер асаалттай эсэхийг шалгана уу.');
  });
  if (!response.ok) throw new Error('Камер зураг өгсөнгүй.');
  const file = new File(Paths.cache, `camera-${Date.now()}-${sequence++}.jpg`);
  file.create({ overwrite: true });
  file.write(new Uint8Array(await response.arrayBuffer()));
  return file.uri;
}

/** Алхах горимын кадрууд ESP32-CAM-аас. Gemini-д мөн адил кадрын хуулбарыг өгнө. */
export const cameraFrames: FrameSource = async () => {
  const uri = await captureJpeg();
  return {
    uri,
    async detailUri() {
      const copy = new File(Paths.cache, `camera-detail-${Date.now()}-${sequence++}.jpg`);
      new File(uri).copySync(copy);
      return copy.uri;
    },
    release: () => deletePhoto(uri),
  };
};
