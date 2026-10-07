import path from 'node:path';

import type { ObjectSource } from './detector';
import type { Detection } from './yolo';

/**
 * OWL-ViT (Google, Apache-2.0) — COCO-д байхгүй зүйлийг текстээр заагаад олдог илрүүлэгч.
 * Туршилтаар хаалгыг 44–68%-иар зөв олсон (YOLO огт олдоггүй), ~170 мс. Шатыг
 * найдвартай олдоггүй тул түүнд ашиглахгүй.
 */
const MODEL = 'Xenova/owlvit-base-patch32';
export const HF_CACHE_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../.cache/hf');

/** OWL-д өгөх англи текст ба манай шошго. */
const QUERIES = [{ query: 'a door', label: 'door' }];
// Үүнээс доош оноотой хүрээ туршилтаар ихэвчлэн шуугиан байсан.
const MIN_SCORE = 0.3;

type ZeroShotPipeline = (
  image: unknown,
  labels: string[],
  options: { threshold: number; percentage: boolean },
) => Promise<{ label: string; score: number; box: { xmin: number; ymin: number; xmax: number; ymax: number } }[]>;

export class OwlVitDetector implements ObjectSource {
  private pipeline: Promise<ZeroShotPipeline> | null = null;
  private failed = false;

  async detectObjects(image: Uint8Array): Promise<Detection[]> {
    if (this.failed) return [];
    try {
      return await this.run(image);
    } catch (error) {
      // Model татагдаагүй эсвэл ачаалж чадаагүй ч YOLO-гийн сэрэмжлүүлэг үргэлжилнэ.
      this.failed = true;
      console.warn('OWL-ViT ажиллахгүй, зөвхөн YOLO ашиглана:', (error as Error).message);
      return [];
    }
  }

  private async run(image: Uint8Array): Promise<Detection[]> {
    // transformers.js хүнд тул анх хэрэг болох үед л ачаална; model ~150 MB-ыг анх татна.
    const { env, pipeline, RawImage } = await import('@huggingface/transformers');
    env.cacheDir = HF_CACHE_DIR;
    this.pipeline ??= pipeline('zero-shot-object-detection', MODEL, { dtype: 'q8' }) as unknown as Promise<ZeroShotPipeline>;
    const detect = await this.pipeline;
    const raw = await RawImage.fromBlob(new Blob([new Uint8Array(image)]));
    const output = await detect(raw, QUERIES.map((q) => q.query), { threshold: MIN_SCORE, percentage: true });
    return output.map(({ label, score, box }) => ({
      label: QUERIES.find((q) => q.query === label)?.label ?? label,
      score,
      box: [box.xmin, box.ymin, box.xmax, box.ymax],
    }));
  }
}
