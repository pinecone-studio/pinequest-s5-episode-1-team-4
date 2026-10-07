import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import type { ErrorResponse } from './schemas';

export type Upload = { image: Uint8Array; mediaType: string; fields: Record<string, unknown> };

const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
// Multipart-ийн boundary, header-т зориулсан нэмэлт зай.
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const MB = 1024 * 1024;

type Check = {
  ok: (file: File | null, maxBytes: number) => boolean;
  status: 400 | 413 | 415 | 422;
  detail: (maxBytes: number) => string;
};

const tooLarge = (maxBytes: number) => `Зураг ${Math.floor(maxBytes / MB)} MB-аас бага байх ёстой.`;

// Дарааллаар нь шалгаж, эхний алдааг буцаана.
const CHECKS: Check[] = [
  { ok: (file) => file !== null, status: 422, detail: () => '"image" талбарт зураг илгээнэ үү.' },
  {
    ok: (file) => SUPPORTED_IMAGE_TYPES.has(file?.type.toLowerCase() ?? ''),
    status: 415,
    detail: () => 'JPEG, PNG эсвэл WebP зураг илгээнэ үү.',
  },
  { ok: (file) => (file?.size ?? 0) > 0, status: 400, detail: () => 'Зургийн файл хоосон байна.' },
  { ok: (file, maxBytes) => (file?.size ?? 0) <= maxBytes, status: 413, detail: tooLarge },
];

/** Том файлыг бүтэн уншихаас өмнө зогсооно. */
export function limitUploadSize(maxBytes: number) {
  return bodyLimit({
    maxSize: maxBytes + MULTIPART_OVERHEAD_BYTES,
    onError: (c) => c.json<ErrorResponse>({ detail: tooLarge(maxBytes) }, 413),
  });
}

/** Зураг зөв ирсэн үед л handler-ийг дуудна; үгүй бол алдааны хариу буцаана. */
export function withUpload(maxBytes: number, handler: (c: Context, upload: Upload) => Promise<Response>) {
  return async (c: Context) => {
    const upload = await readUpload(c, maxBytes);
    return upload instanceof Response ? upload : handler(c, upload);
  };
}

/** Multipart-аас "image" талбарыг уншиж шалгана; алдаатай бол бэлэн хариу буцаана. */
export async function readUpload(c: Context, maxBytes: number): Promise<Upload | Response> {
  const fields = await c.req.parseBody();
  const image = fields.image instanceof File ? fields.image : null;
  const failed = CHECKS.find((check) => !check.ok(image, maxBytes));
  if (failed) return c.json<ErrorResponse>({ detail: failed.detail(maxBytes) }, failed.status);
  const file = image as File;
  return { image: new Uint8Array(await file.arrayBuffer()), mediaType: file.type.toLowerCase(), fields };
}
