export type HealthResponse = {
  status: 'ok';
};

export type AnalysisResponse = {
  /** Хэрэглэгчид уншиж өгөх товч Монгол тайлбар. */
  description: string;
  /** Монгол дуу (WAV, base64); байхгүй бол апп төхөөрөмжийн TTS ашиглана. */
  audio_base64: string | null;
};

export type WalkResponse = {
  /** Шинэ, чухал зүйл байвал нэг богино өгүүлбэр; үгүй бол null — апп чимээгүй байна. */
  description: string | null;
  audio_base64: string | null;
};

export type DetectResponse = {
  /** Хамгийн чухал зүйлийн Монгол өгүүлбэр, эсвэл null. */
  alert: string | null;
  audio_base64: string | null;
  /** Зөвхөн урд замд байгаа зүйлс, чухлаас нь. */
  hazards: { name: string; direction: 'left' | 'ahead' | 'right'; close: boolean; score: number; x: number }[];
  inference_ms: number;
};

export type ErrorResponse = {
  detail: string;
};
