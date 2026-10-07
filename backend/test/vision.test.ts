import { describe, expect, it } from 'vitest';

import { GeminiSceneAnalyzer, SCENE_INSTRUCTIONS, SceneAnalysisError, thinkingConfigFor } from '../src/vision';

const IMAGE = new TextEncoder().encode('image-bytes');
const SETTINGS = { geminiApiKey: 'test-key', geminiModel: 'gemini-test', geminiFallbackModels: [] };

// Жинхэнэ Gemini-г дуудахгүй — CI-д түлхүүр хэрэггүй.
function fakeGemini(reply: { text?: string }) {
  const calls: any[] = [];
  const client = {
    models: {
      generateContent: async (params: unknown) => {
        calls.push(params);
        return reply;
      },
    },
  };
  return { calls, factory: () => client as any };
}

describe('GeminiSceneAnalyzer', () => {
  it('sends the photo inline with the scene instructions', async () => {
    const { calls, factory } = fakeGemini({ text: ' Урд хаалга байна. ' });

    const result = await new GeminiSceneAnalyzer(SETTINGS, factory).analyze(IMAGE, 'image/jpeg');

    expect(result).toBe('Урд хаалга байна.');
    expect(calls[0].model).toBe('gemini-test');
    expect(calls[0].contents[0].inlineData).toEqual({
      data: Buffer.from(IMAGE).toString('base64'),
      mimeType: 'image/jpeg',
    });
    expect(calls[0].config.systemInstruction).toBe(SCENE_INSTRUCTIONS);
  });

  it.each([
    ['a missing API key', { ...SETTINGS, geminiApiKey: undefined }, { text: 'x' }],
    ['an empty answer', SETTINGS, { text: '  ' }],
  ])('reports %s as a 503', async (_name, settings, reply) => {
    const error = await new GeminiSceneAnalyzer(settings, fakeGemini(reply).factory)
      .analyze(IMAGE, 'image/jpeg')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SceneAnalysisError);
    expect((error as SceneAnalysisError).status).toBe(503);
  });
});

describe('thinkingConfigFor', () => {
  it('turns thinking off the way each Gemini generation accepts', () => {
    expect(thinkingConfigFor('gemini-2.5-flash')).toEqual({ thinkingBudget: 0 });
    expect(thinkingConfigFor('gemini-3.5-flash')).toEqual({ thinkingLevel: 'LOW' });
  });
});
