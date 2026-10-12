import { HF_CACHE_DIR } from './openVocab';
import { NO_CHANGE, type AnalysisRequest, type SceneAnalyzer } from './vision';

/**
 * Алхах горимын Gemini-ийн оронд шатыг OWLv2 (Google, Apache-2.0, ViT)-оор локал олно —
 * Gemini-ийн 429/503 алдаа, үнэгүй хязгаараас хамаарахгүй. Туршилтаар шаттай зурагт 45–49%,
 * шатгүйд 29%-иас бага оноо өгсөн; M4 CPU дээр ~1.7 сек тул 6 сек тутам ар талд хангалттай.
 * Нүх, ирмэгийг найдвартай ялгаагүй тул зөвхөн шат.
 */
const MODEL = 'Xenova/owlv2-base-patch16-ensemble';
const QUERY = 'stairs';
const MIN_SCORE = 0.4;

type Box = { xmin: number; ymin: number; xmax: number; ymax: number };
type ZeroShotPipeline = (
  image: unknown,
  labels: string[],
  options: { threshold: number; percentage: boolean },
) => Promise<{ score: number; box: Box }[]>;

/** Хамгийн итгэлтэй шатны байрлалаар "Урд шат байна." гэх мэт өгүүлбэр. */
export function stairsSentence(found: { score: number; box: Box }[]): string | null {
  const best = found.filter((d) => d.score >= MIN_SCORE).sort((a, b) => b.score - a.score)[0];
  if (!best) return null;
  const center = (best.box.xmin + best.box.xmax) / 2;
  return center < 0.35 ? 'Зүүн талд шат байна.' : center > 0.65 ? 'Баруун талд шат байна.' : 'Урд шат байна.';
}

export class LocalWalkAnalyzer implements SceneAnalyzer {
  private pipeline: Promise<ZeroShotPipeline> | null = null;

  async analyze(image: Uint8Array, _mediaType: string, request?: AnalysisRequest): Promise<string> {
    if (request?.mode !== 'walk') throw new Error('Локал шинжилгээ зөвхөн алхах горимд.');
    const { env, pipeline, RawImage } = await import('@huggingface/transformers');
    env.cacheDir = HF_CACHE_DIR;
    this.pipeline ??= pipeline('zero-shot-object-detection', MODEL, { dtype: 'q8' }) as unknown as Promise<ZeroShotPipeline>;
    const detect = await this.pipeline;
    const raw = await RawImage.fromBlob(new Blob([new Uint8Array(image)]));
    const sentence = stairsSentence(await detect(raw, [QUERY], { threshold: MIN_SCORE / 2, percentage: true }));
    // Өмнө хэлснээ давтахгүй — Gemini-ийн заавартай адил.
    return sentence && sentence !== request.previous ? sentence : NO_CHANGE;
  }
}
