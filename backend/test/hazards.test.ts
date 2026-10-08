import { describe, expect, it } from 'vitest';

import { toHazards } from '../src/hazards';
import type { Box } from '../src/yolo';

const detection = (label: string, box: Box, score = 0.9) => ({ label, box, score });

describe('toHazards', () => {
  it('works out direction and closeness from the box', () => {
    const [left, ahead, right] = [[0.0, 0.3, 0.2, 0.6], [0.4, 0.3, 0.6, 0.6], [0.8, 0.3, 1.0, 0.6]].map(
      (box) => toHazards([detection('person', box as Box)])[0],
    );

    expect([left.direction, ahead.direction, right.direction]).toEqual(['left', 'ahead', 'right']);
    expect(ahead.close).toBe(false);
    expect(toHazards([detection('car', [0.3, 0.2, 0.7, 0.9])])[0].close).toBe(true);
  });

  it('puts close and dangerous things first and ignores what does not matter', () => {
    const hazards = toHazards([
      detection('chair', [0.4, 0.4, 0.6, 0.6]),
      detection('fork', [0.4, 0.4, 0.6, 0.6]),
      detection('car', [0.75, 0.4, 0.95, 0.6]),
      detection('person', [0.3, 0.1, 0.7, 0.95]),
    ]);
    expect(hazards.map((h) => h.label)).toEqual(['person', 'car', 'chair']);
  });

  it("ignores the user's own legs but not a person standing close ahead", () => {
    expect(toHazards([detection('person', [0.2, 0.55, 0.8, 1.0])])).toEqual([]);
    expect(toHazards([detection('person', [0.3, 0.1, 0.7, 1.0])])[0]).toMatchObject({ direction: 'ahead', close: true });
  });

  it('ignores classes YOLO confused with stairs and doors unless very confident', () => {
    expect(toHazards([detection('bench', [0.3, 0.3, 0.7, 0.7], 0.62)])).toEqual([]);
    expect(toHazards([detection('bed', [0.3, 0.3, 0.7, 0.7], 0.67)])).toEqual([]);
    expect(toHazards([detection('bench', [0.3, 0.3, 0.7, 0.7], 0.8)])).toHaveLength(1);
  });

  it('keeps the higher score when two detectors find the same thing', () => {
    const hazards = toHazards([detection('person', [0.4, 0.2, 0.6, 0.6], 0.6), detection('person', [0.41, 0.21, 0.61, 0.61], 0.9)]);
    expect(hazards.map((h) => h.score)).toEqual([0.9]);
  });
});
