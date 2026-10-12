import type { ObjectSource } from './detector';
import { HF_CACHE_DIR } from './openVocab';
import type { Detection } from './yolo';

/**
 * RF-DETR Nano (Roboflow, Apache-2.0) — DINOv2 (ViT) дээр суурилсан COCO илрүүлэгч, NMS-гүй.
 * Туршилтаар YOLOX-s-ийн алдсан гудамжны нохойг 95%-иар олсон; M4 CPU дээр ~60 мс.
 */
const MODEL = 'onnx-community/rfdetr_nano-ONNX';
// YOLOX-ийн босготой ижил — hazards.ts-ийн minScore-ууд түүнд тохируулагдсан.
const MIN_SCORE = 0.5;

type Box = { xmin: number; ymin: number; xmax: number; ymax: number };
type DetectionPipeline = (
  image: unknown,
  options: { threshold: number; percentage: boolean },
) => Promise<{ label: string; score: number; box: Box }[]>;

export function toDetection({ label, score, box }: { label: string; score: number; box: Box }): Detection {
  return { label, score, box: [box.xmin, box.ymin, box.xmax, box.ymax] };
}

export class RfDetrModel implements ObjectSource {
  private pipeline: Promise<DetectionPipeline> | null = null;

  async detectObjects(image: Uint8Array): Promise<Detection[]> {
    // transformers.js хүнд тул анх хэрэг болох үед л ачаална; model ~100 MB-ыг анх татна.
    const { env, pipeline, RawImage } = await import('@huggingface/transformers');
    env.cacheDir = HF_CACHE_DIR;
    this.pipeline ??= pipeline('object-detection', MODEL, { dtype: 'fp32' }) as unknown as Promise<DetectionPipeline>;
    const detect = await this.pipeline;
    const raw = await RawImage.fromBlob(new Blob([new Uint8Array(image)]));
    return (await detect(raw, { threshold: MIN_SCORE, percentage: true })).map(toDetection);
  }
}
