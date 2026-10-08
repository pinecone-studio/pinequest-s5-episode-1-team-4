import { iou, type Detection } from './yolo';

type Rule = { name: string; priority: number; minScore?: number };

/**
 * Алхаж буй хүнд хамаатай зүйлс ба ач холбогдол (их нь түрүүлж хэлэгдэнэ).
 * Жагсаалтад байхгүй ангилал (сэрээ, гар утас гэх мэт) сэрэмжлүүлэгт орохгүй.
 */
const HAZARDS: Record<string, Rule> = {
  car: { name: 'машин', priority: 10 },
  bus: { name: 'автобус', priority: 10 },
  truck: { name: 'ачааны машин', priority: 10 },
  motorcycle: { name: 'мотоцикл', priority: 10 },
  train: { name: 'галт тэрэг', priority: 10 },
  bicycle: { name: 'дугуй', priority: 9 },
  person: { name: 'хүн', priority: 8 },
  dog: { name: 'нохой', priority: 8 },
  horse: { name: 'морь', priority: 8 },
  cow: { name: 'үхэр', priority: 8 },
  sheep: { name: 'хонь', priority: 7 },
  cat: { name: 'муур', priority: 6 },
  'traffic light': { name: 'гэрлэн дохио', priority: 6 },
  'stop sign': { name: 'Зогс тэмдэг', priority: 6 },
  'fire hydrant': { name: 'галын цорго', priority: 6 },
  // Шатны туршилтад YOLO шат, бариулыг "вандан сандал" (62%) гэж андуурсан.
  bench: { name: 'вандан сандал', priority: 6, minScore: 0.75 },
  chair: { name: 'сандал', priority: 5 },
  couch: { name: 'буйдан', priority: 5 },
  'dining table': { name: 'ширээ', priority: 5 },
  // Хагас нээлттэй хаалга, шатны талбайг "ор" (51–67%) гэж андуурсан.
  bed: { name: 'ор', priority: 5, minScore: 0.8 },
  'potted plant': { name: 'ваартай цэцэг', priority: 5 },
  suitcase: { name: 'чемодан', priority: 5 },
  backpack: { name: 'үүргэвч', priority: 4 },
  handbag: { name: 'цүнх', priority: 4 },
  umbrella: { name: 'шүхэр', priority: 4 },
  skateboard: { name: 'скейтборд', priority: 4 },
  bottle: { name: 'лонх', priority: 3 },
  toilet: { name: 'суултуур', priority: 3 },
  // Саарал хаалгыг "хөргөгч" гэж андуурсан.
  refrigerator: { name: 'хөргөгч', priority: 3, minScore: 0.7 },
  tv: { name: 'зурагт', priority: 2 },
  // OWL-ViT — оноо нь YOLO-оос өөр хуваарьтай.
  door: { name: 'хаалга', priority: 6, minScore: 0.35 },
};

export const VEHICLE_PRIORITY = 10;

export type Direction = 'left' | 'ahead' | 'right';

export type Hazard = Detection & {
  name: string;
  priority: number;
  direction: Direction;
  close: boolean;
  /** Сэрэмжлүүлэх ёстой эсэх: урд замд эсвэл ойрхон, эсвэл тээврийн хэрэгсэл. */
  inPath: boolean;
};

export function ruleFor(label: string): Rule | undefined {
  return HAZARDS[label];
}

/** Утсаа доош хазайлгахад хэрэглэгчийн өөрийн хөл кадрын доод хагаст "хүн" болж илэрдэг. */
function isOwnBody({ label, box: [, y1, , y2] }: Detection) {
  return label === 'person' && y1 >= 0.5 && y2 >= 0.95;
}

function isRelevant(detection: Detection) {
  const rule = HAZARDS[detection.label];
  return rule !== undefined && detection.score >= (rule.minScore ?? 0) && !isOwnBody(detection);
}

/** YOLO, OWL-ViT хоёр ижил зүйлийг олсон бол өндөр оноотойг нь үлдээнэ. */
function mergeDuplicates(detections: Detection[]): Detection[] {
  const kept: Detection[] = [];
  for (const detection of [...detections].sort((a, b) => b.score - a.score)) {
    const duplicate = kept.some((o) => o.label === detection.label && iou(o.box, detection.box) > 0.5);
    if (!duplicate) kept.push(detection);
  }
  return kept;
}

function toHazard(detection: Detection): Hazard {
  const { name, priority } = HAZARDS[detection.label];
  const [x1, y1, x2, y2] = detection.box;
  const centerX = (x1 + x2) / 2;
  const direction: Direction = centerX < 0.35 ? 'left' : centerX > 0.65 ? 'right' : 'ahead';
  // Кадрын өндрийн талаас илүүг эзэлсэн эсвэл доод ирмэгт том хүрсэн бол ойрхон.
  const close = y2 - y1 > 0.5 || (y2 > 0.92 && (x2 - x1) * (y2 - y1) > 0.12);
  // Хажуугаар өнгөрөх сандлыг хэлэх нь шуугиан; машиныг хаана ч хэлнэ.
  const inPath = direction === 'ahead' || close || priority >= VEHICLE_PRIORITY;
  return { ...detection, name, priority, direction, close, inPath };
}

export function byImportance(a: Hazard, b: Hazard) {
  return (
    Number(b.close) - Number(a.close) ||
    b.priority - a.priority ||
    Number(b.direction === 'ahead') - Number(a.direction === 'ahead') ||
    b.score - a.score
  );
}

/** Илрүүлэлтээс алхаж буй хүнд хамаатайг нь сонгож, чиглэл, ойрын эсэхийг тооцно. */
export function toHazards(detections: Detection[]): Hazard[] {
  return mergeDuplicates(detections).filter(isRelevant).map(toHazard).sort(byImportance);
}
