import { NO_CHANGE } from './vision';

/** Model "-" гэх мэтээр "шинэ зүйл алга" гэж хариулсныг танина. */
export function isNoChange(text: string): boolean {
  const stripped = text.replace(/[\s.。]/g, '');
  return stripped === '' || stripped === NO_CHANGE || /^[-–—]+$/.test(stripped);
}

/**
 * Хаалга, хүн, тавилгыг YOLO/OWL-ViT хурдан бөгөөд зөв чиглэлтэй хэлдэг. Gemini
 * заавраа үл тоон эдгээрийг (заримдаа буруу чиглэлтэй) хэлдэг тул тэр өгүүлбэрийг хасна.
 * Машин, амьтныг аюулын давхар хамгаалалт болгон үлдээнэ.
 */
const DETECTOR_OBJECTS = /(?:^|[\s,.!?«"(])(?:хаалга|хүн(?!д)|хүмүүс|хүүхэд|сандал|ширээ|буйдан|хөргөгч)/iu;

export function withoutDetectorObjects(text: string): string | null {
  const kept = text
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !DETECTOR_OBJECTS.test(sentence))
    .join(' ')
    .trim();
  return kept === '' ? null : kept;
}
