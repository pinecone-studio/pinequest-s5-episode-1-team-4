import { describe, expect, it } from 'vitest';

import { GeminiSceneAnalyzer, WALK_INSTRUCTIONS } from '../src/vision';

const IMAGE = new Uint8Array([1]);
const SETTINGS = { geminiApiKey: 'k', geminiModel: 'main', geminiFallbackModels: [], geminiWalkModel: 'walk-a', geminiWalkAlternates: ['walk-b'] };

function analyzer() {
  const calls: any[] = [];
  const client = { models: { generateContent: async (params: unknown) => (calls.push(params), { text: '-' }) } };
  return { calls, analyzer: new GeminiSceneAnalyzer(SETTINGS, () => client as any) };
}

describe('walking mode prompt', () => {
  it('uses the light walk model, walk instructions and the previous message', async () => {
    const { calls, analyzer: gemini } = analyzer();

    await gemini.analyze(IMAGE, 'image/jpeg', { mode: 'walk', previous: 'Урд шат байна.' });

    expect(calls[0].model).toBe('walk-a');
    expect(calls[0].config.systemInstruction).toBe(WALK_INSTRUCTIONS);
    expect(calls[0].contents.at(-1)).toContain('Урд шат байна.');
  });

  it('sends the walking-path close-up as a second image', async () => {
    const { calls, analyzer: gemini } = analyzer();

    await gemini.analyze(IMAGE, 'image/jpeg', { mode: 'walk', pathCloseUp: new Uint8Array([2]) });

    const images = calls[0].contents.filter((part: any) => part.inlineData);
    expect(images.map((part: any) => part.inlineData.data)).toEqual(['AQ==', 'Ag==']);
  });

  it('alternates free walk models so each stays under its own quota', async () => {
    const { calls, analyzer: gemini } = analyzer();

    for (let i = 0; i < 3; i++) await gemini.analyze(IMAGE, 'image/jpeg', { mode: 'walk' });
    await gemini.analyze(IMAGE, 'image/jpeg');

    expect(calls.map((call) => call.model)).toEqual(['walk-a', 'walk-b', 'walk-a', 'main']);
  });
});
