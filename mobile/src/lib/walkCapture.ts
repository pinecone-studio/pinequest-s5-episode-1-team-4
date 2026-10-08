/** Алхах горимын нэг кадр. */
export type WalkFrame = {
  /** YOLO/OWL-д илгээх зураг (640px орчим). */
  uri: string;
  /** Gemini-д илүү тод зураг — хэрэгтэй үед л авна. Дуудагч нь устгана. */
  detailUri(): Promise<string>;
  /** Энэ кадрын түр файлуудыг устгана (detailUri-гаас бусад). */
  release(): void;
};

/** Кадр авах эх үүсвэр (ESP32-CAM гэх мэт). Кадр гараагүй бол null. */
export type FrameSource = () => Promise<WalkFrame | null>;
