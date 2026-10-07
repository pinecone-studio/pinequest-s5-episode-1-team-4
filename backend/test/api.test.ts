import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app';

describe('health', () => {
  it('reports that the API is up', async () => {
    const response = await createApp().request('/health');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });
});
