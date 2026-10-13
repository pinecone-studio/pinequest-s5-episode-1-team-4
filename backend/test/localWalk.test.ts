import { describe, expect, it } from 'vitest';

import { loadSettings } from '../src/config';
import { stairsSentence } from '../src/localWalk';

const box = (xmin: number, xmax: number) => ({ xmin, ymin: 0.3, xmax, ymax: 0.9 });

describe('stairsSentence', () => {
  it('says where the most confident stairs are', () => {
    expect(stairsSentence([{ score: 0.45, box: box(0.3, 0.7) }])).toBe('Урд шат байна.');
    expect(stairsSentence([{ score: 0.42, box: box(0.0, 0.3) }, { score: 0.49, box: box(0.7, 1.0) }])).toBe('Баруун талд шат байна.');
  });

  it('ignores weak matches that were mostly false in testing', () => {
    expect(stairsSentence([{ score: 0.29, box: box(0.3, 0.7) }])).toBeNull();
    expect(stairsSentence([])).toBeNull();
  });

  it('is used only when WALK_ANALYZER=local', () => {
    expect(loadSettings({}).walkAnalyzer).toBe('gemini');
    expect(loadSettings({ WALK_ANALYZER: 'local' }).walkAnalyzer).toBe('local');
  });
});
