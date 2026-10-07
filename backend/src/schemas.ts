export type HealthResponse = {
  status: 'ok';
};

export type AnalysisResponse = {
  /** Хэрэглэгчид уншиж өгөх товч Монгол тайлбар. */
  description: string;
  /** Монгол дуу (WAV, base64); байхгүй бол апп төхөөрөмжийн TTS ашиглана. */
  audio_base64: string | null;
};

export type ErrorResponse = {
  detail: string;
};
