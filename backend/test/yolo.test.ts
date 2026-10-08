import { describe, expect, it } from 'vitest';

import { decodeDetections } from '../src/yolo';

const COLUMNS = 85;
const FRAME = { ratio: 1, width: 640, height: 640 };

/** YOLOX-ийн гаралтыг дуурайна: stride 32-ийн (gx, gy) нүдэнд 128×256px нэг зүйл. */
function fakeOutput(classIndex: number, gx: number, gy: number, score = 0.9) {
  const output = new Float32Array(8400 * COLUMNS);
  const offset = (80 * 80 + 40 * 40 + gy * 20 + gx) * COLUMNS;
  output.set([0.5, 0.5, Math.log(4), Math.log(8), score], offset);
  output[offset + 5 + classIndex] = 1;
  return output;
}

describe('decodeDetections', () => {
  it('turns grid offsets into image coordinates', () => {
    // stride 32-ийн (10, 10) нүд → төв (336, 336).
    const [found] = decodeDetections(fakeOutput(2, 10, 10), FRAME);

    expect(found.label).toBe('car');
    expect(found.score).toBeCloseTo(0.9);
    expect(found.box.map((value) => Math.round(value * 640))).toEqual([272, 208, 400, 464]);
  });

  it('drops low scores and overlapping duplicates', () => {
    const output = fakeOutput(0, 5, 5);
    const duplicate = (80 * 80 + 40 * 40 + 5 * 20 + 6) * COLUMNS;
    output.set([0.0, 0.5, Math.log(4), Math.log(8), 0.8], duplicate);
    output[duplicate + 5] = 1;

    expect(decodeDetections(output, FRAME)).toHaveLength(1);
    expect(decodeDetections(fakeOutput(0, 5, 5, 0.2), FRAME)).toHaveLength(0);
  });
});
