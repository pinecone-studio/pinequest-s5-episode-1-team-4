import { describe, expect, it } from 'vitest';

import { loadSettings } from '../src/config';
import { toDetection } from '../src/rfdetr';

describe('RF-DETR', () => {
  it('converts pipeline boxes to the shared 0–1 [x1, y1, x2, y2] format', () => {
    expect(toDetection({ label: 'dog', score: 0.95, box: { xmin: 0.1, ymin: 0.6, xmax: 0.3, ymax: 0.9 } })).toEqual({
      label: 'dog',
      score: 0.95,
      box: [0.1, 0.6, 0.3, 0.9],
    });
  });

  it('is chosen only when DETECTOR=rfdetr', () => {
    expect(loadSettings({}).detector).toBe('yolox');
    expect(loadSettings({ DETECTOR: 'rfdetr' }).detector).toBe('rfdetr');
    expect(loadSettings({ DETECTOR: 'other' }).detector).toBe('yolox');
  });
});
