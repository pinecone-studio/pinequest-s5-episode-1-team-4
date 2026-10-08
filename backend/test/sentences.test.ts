import { describe, expect, it } from 'vitest';

import { commonAlerts, describeHazards, toHazards } from '../src/hazards';
import type { Box } from '../src/yolo';

const detection = (label: string, box: Box, score = 0.9) => ({ label, box, score });

describe('describeHazards', () => {
  it('says only the most important hazard by default', () => {
    const hazards = toHazards([
      detection('person', [0.3, 0.1, 0.7, 0.95]),
      detection('car', [0.75, 0.4, 0.95, 0.6]),
      detection('chair', [0.4, 0.4, 0.6, 0.6]),
    ]);
    expect(describeHazards(hazards)).toBe('Урд ойрхон хүн байна.');
    expect(describeHazards(hazards, 2)).toBe('Урд ойрхон хүн, баруун талд машин байна.');
  });

  it('skips things beside the path but always warns about vehicles', () => {
    expect(describeHazards(toHazards([detection('chair', [0.0, 0.4, 0.2, 0.6])]))).toBeNull();
    expect(describeHazards(toHazards([detection('car', [0.8, 0.4, 1.0, 0.6])]))).toBe('Баруун талд машин байна.');
    expect(describeHazards(toHazards([detection('chair', [0.0, 0.2, 0.3, 0.95])]))).toBe('Зүүн талд ойрхон сандал байна.');
  });

  it('applies the door score floor', () => {
    expect(toHazards([detection('door', [0.4, 0.1, 0.6, 0.9], 0.3)])).toEqual([]);
    expect(describeHazards(toHazards([detection('door', [0.4, 0.1, 0.6, 0.9], 0.5)]))).toBe('Урд ойрхон хаалга байна.');
  });
});

describe('commonAlerts', () => {
  it('lists frequent alerts for vehicles, people, animals and doors', () => {
    const alerts = commonAlerts();
    expect(alerts).toContain('Урд ойрхон хүн байна.');
    expect(alerts).toContain('Зүүн талд машин байна.');
    expect(alerts).toContain('Баруун талд ойрхон хаалга байна.');
    expect(alerts).not.toContain('Урд сандал байна.');
    expect(new Set(alerts).size).toBe(alerts.length);
  });
});
