import path from 'node:path';

import ort from 'onnxruntime-node';
import sharp from 'sharp';

import { decodeDetections, INPUT_SIZE, type Detection } from './yolo';

export const DEFAULT_MODEL_PATH = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../models/yolox_s.onnx');

const PAD_VALUE = 114;

/** Харьцааг хадгалж 640 болгоод 114-өөр нөхнө; BGR, CHW. */
async function preprocess(image: Uint8Array) {
  const oriented = sharp(image).rotate();
  const meta = await oriented.metadata();
  // EXIF-ээр эргэсэн зургийн өргөн, өндөр солигдоно.
  const [width = INPUT_SIZE, height = INPUT_SIZE] =
    (meta.orientation ?? 1) >= 5 ? [meta.height, meta.width] : [meta.width, meta.height];
  const ratio = Math.min(INPUT_SIZE / width, INPUT_SIZE / height);
  const [w, h] = [Math.round(width * ratio), Math.round(height * ratio)];
  const { data } = await oriented.resize(w, h, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const plane = INPUT_SIZE * INPUT_SIZE;
  const tensor = new Float32Array(3 * plane).fill(PAD_VALUE);
  for (let i = 0; i < w * h; i++) {
    const target = Math.floor(i / w) * INPUT_SIZE + (i % w);
    [tensor[target], tensor[plane + target], tensor[2 * plane + target]] = [data[i * 3 + 2], data[i * 3 + 1], data[i * 3]];
  }
  return { tensor, frame: { ratio, width, height } };
}

/** COCO-ийн илрүүлэлтүүдийг (шүүлтгүй) буцаана; model-ыг анх дуудахад ачаална. */
export class YoloxModel {
  private session: Promise<ort.InferenceSession> | null = null;

  constructor(readonly modelPath = DEFAULT_MODEL_PATH) {}

  async detectObjects(image: Uint8Array): Promise<Detection[]> {
    this.session ??= ort.InferenceSession.create(this.modelPath);
    const session = await this.session;
    const { tensor, frame } = await preprocess(image);
    const outputs = await session.run({
      [session.inputNames[0]]: new ort.Tensor('float32', tensor, [1, 3, INPUT_SIZE, INPUT_SIZE]),
    });
    return decodeDetections(outputs[session.outputNames[0]].data as Float32Array, frame);
  }
}
