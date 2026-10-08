/** YOLOX-S (Apache-2.0) гаралтыг задлах: COCO-ийн 80 ангилал, stride 8/16/32 grid. */
export const INPUT_SIZE = 640;
const STRIDES = [8, 16, 32];
// Бага итгэлцэлтэй илрүүлэлт гэрийн орчинд олон худал сэрэмжлүүлэг үүсгэсэн.
const SCORE_THRESHOLD = 0.5;
const IOU_THRESHOLD = 0.45;

// YOLOX-ийн гаралтын 5..84 баганын дараалал.
const COCO_CLASSES = [
  'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat',
  'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat', 'dog',
  'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe', 'backpack', 'umbrella',
  'handbag', 'tie', 'suitcase', 'frisbee', 'skis', 'snowboard', 'sports ball', 'kite',
  'baseball bat', 'baseball glove', 'skateboard', 'surfboard', 'tennis racket', 'bottle',
  'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple', 'sandwich', 'orange',
  'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair', 'couch', 'potted plant',
  'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse', 'remote', 'keyboard', 'cell phone',
  'microwave', 'oven', 'toaster', 'sink', 'refrigerator', 'book', 'clock', 'vase', 'scissors',
  'teddy bear', 'hair drier', 'toothbrush',
] as const;
const COLUMNS = 5 + COCO_CLASSES.length;

export type Box = [number, number, number, number];

export type Detection = {
  /** COCO-ийн ангилал (YOLO) эсвэл нээлттэй үгсийн сангийн шошго (OWL-ViT). */
  label: string;
  score: number;
  /** Зургийн хэмжээнд харьцуулсан [x1, y1, x2, y2], 0–1. */
  box: Box;
};

type Candidate = { classIndex: number; score: number; box: Box };
type Frame = { ratio: number; width: number; height: number };
type Cell = { stride: number; gx: number; gy: number };

// Гаралтын 8400 мөр нь stride 8, 16, 32-ийн grid-ийн нүднүүд дарааллаараа.
const CELLS: Cell[] = STRIDES.flatMap((stride) => {
  const n = INPUT_SIZE / stride;
  return Array.from({ length: n * n }, (_, i) => ({ stride, gx: i % n, gy: Math.floor(i / n) }));
});

const clamp = (value: number) => Math.min(1, Math.max(0, value));

export function iou(a: Box, b: Box) {
  const width = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const height = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const intersection = width * height;
  const union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - intersection;
  return union > 0 ? intersection / union : 0;
}

/** Grid-ийн нэг нүдний гаралтыг (шилжилт, оноо) зургийн координат болгоно. */
function candidateAt(output: Float32Array, row: number, { stride, gx, gy }: Cell, frame: Frame): Candidate | null {
  const offset = row * COLUMNS;
  let classIndex = 0;
  for (let c = 1; c < COCO_CLASSES.length; c++) {
    classIndex = output[offset + 5 + c] > output[offset + 5 + classIndex] ? c : classIndex;
  }
  const score = output[offset + 4] * output[offset + 5 + classIndex];
  if (score < SCORE_THRESHOLD) return null;
  const cx = (output[offset] + gx) * stride;
  const cy = (output[offset + 1] + gy) * stride;
  const w = Math.exp(output[offset + 2]) * stride;
  const h = Math.exp(output[offset + 3]) * stride;
  const toX = (x: number) => clamp(x / frame.ratio / frame.width);
  const toY = (y: number) => clamp(y / frame.ratio / frame.height);
  return { classIndex, score, box: [toX(cx - w / 2), toY(cy - h / 2), toX(cx + w / 2), toY(cy + h / 2)] };
}

/** Ижил ангиллын давхардсан хайрцгаас өндөр оноотойг нь үлдээнэ. */
function nonMaxSuppression(candidates: Candidate[]): Candidate[] {
  const kept: Candidate[] = [];
  for (const candidate of [...candidates].sort((a, b) => b.score - a.score)) {
    const duplicate = kept.some((o) => o.classIndex === candidate.classIndex && iou(o.box, candidate.box) > IOU_THRESHOLD);
    if (!duplicate) kept.push(candidate);
  }
  return kept;
}

export function decodeDetections(output: Float32Array, frame: Frame): Detection[] {
  const candidates = CELLS.map((cell, row) => candidateAt(output, row, cell, frame)).filter(
    (candidate): candidate is Candidate => candidate !== null,
  );
  return nonMaxSuppression(candidates).map(({ classIndex, score, box }) => ({ label: COCO_CLASSES[classIndex], score, box }));
}
