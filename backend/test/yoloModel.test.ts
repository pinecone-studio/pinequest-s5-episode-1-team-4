import { existsSync } from 'node:fs';

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { DEFAULT_MODEL_PATH, YoloxModel } from '../src/yoloModel';

// Model-ыг `npm run download-model`-оор татсан үед л (CI-д байхгүй).
describe.skipIf(!existsSync(DEFAULT_MODEL_PATH))('YoloxModel', () => {
  it('runs quickly and finds nothing on an empty image', async () => {
    const empty = await sharp({ create: { width: 1280, height: 960, channels: 3, background: '#ccc' } }).jpeg().toBuffer();
    const model = new YoloxModel();
    await model.detectObjects(new Uint8Array(empty));

    const started = performance.now();
    expect(await model.detectObjects(new Uint8Array(empty))).toEqual([]);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
