import { describeHazards, toHazards, type Hazard } from './hazards';
import type { Detection } from './yolo';

export type DetectionResult = {
  hazards: Hazard[];
  alert: string | null;
  inferenceMs: number;
};

export interface ObjectDetector {
  /** false бол model байхгүй (татаагүй). */
  readonly available?: boolean;
  detect(image: Uint8Array): Promise<DetectionResult>;
}

export interface ObjectSource {
  detectObjects(image: Uint8Array): Promise<Detection[]>;
}

/** Илрүүлэгчдийг зэрэг ажиллуулж, үр дүнг нэгтгээд сэрэмжлүүлэг болгоно. */
export class HazardDetector implements ObjectDetector {
  constructor(
    private readonly sources: ObjectSource[],
    readonly available = true,
  ) {}

  async detect(image: Uint8Array): Promise<DetectionResult> {
    const started = performance.now();
    const found = await Promise.all(this.sources.map((source) => source.detectObjects(image)));
    const hazards = toHazards(found.flat());
    return { hazards, alert: describeHazards(hazards), inferenceMs: performance.now() - started };
  }
}
