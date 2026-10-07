import { ApiError } from '@google/genai';
import { describe, expect, it } from 'vitest';

import { GeminiSceneAnalyzer, SceneAnalysisError } from '../src/vision';

const IMAGE = new TextEncoder().encode('image-bytes');
const SETTINGS = { geminiApiKey: 'k', geminiModel: 'main', geminiFallbackModels: ['backup'] };
const overloaded = (status: number) => new ApiError({ message: 'busy', status });

/** `replies` нь model бүрийн хариу: Error бол шиднэ, текст бол буцаана. */
function fakeGemini(replies: Record<string, (Error | string)[]>) {
  const calls: string[] = [];
  const client = {
    models: {
      generateContent: async ({ model }: { model: string }) => {
        calls.push(model);
        const reply = replies[model].shift() ?? 'Урд шат байна.';
        if (reply instanceof Error) throw reply;
        return { text: reply };
      },
    },
  };
  return { calls, factory: () => client as any };
}

describe('Gemini fallback', () => {
  it.each([
    ['is overloaded', overloaded(503)],
    ['hits its rate limit', overloaded(429)],
    ['is too slow', new DOMException('aborted', 'AbortError')],
  ])('tries the backup model when the main one %s', async (_name, error) => {
    const { calls, factory } = fakeGemini({ main: [error], backup: [] });

    const result = await new GeminiSceneAnalyzer(SETTINGS, factory).analyze(IMAGE, 'image/jpeg');

    expect(result).toBe('Урд шат байна.');
    expect(calls).toEqual(['main', 'backup']);
  });

  it('does not retry errors another model would not fix', async () => {
    const { calls, factory } = fakeGemini({ main: [overloaded(400)], backup: [] });

    const error = await new GeminiSceneAnalyzer(SETTINGS, factory).analyze(IMAGE, 'image/jpeg').catch((e) => e);

    expect(error).toEqual(new SceneAnalysisError(502, 'Зургийг одоогоор шинжилж чадсангүй.'));
    expect(calls).toEqual(['main']);
  });

  it('explains a used-up free quota in Mongolian', async () => {
    const { factory } = fakeGemini({ main: [overloaded(429)], backup: [overloaded(429)] });

    const error = await new GeminiSceneAnalyzer(SETTINGS, factory).analyze(IMAGE, 'image/jpeg').catch((e) => e);

    expect((error as SceneAnalysisError).detail).toContain('Үнэгүй хязгаар');
  });

  it('skips a rate-limited model for a minute', async () => {
    let clock = 0;
    const { calls, factory } = fakeGemini({ main: [overloaded(429)], backup: [] });
    const analyzer = new GeminiSceneAnalyzer(SETTINGS, factory, () => clock);

    await analyzer.analyze(IMAGE, 'image/jpeg');
    await analyzer.analyze(IMAGE, 'image/jpeg');
    clock = 60_000;
    await analyzer.analyze(IMAGE, 'image/jpeg');

    expect(calls).toEqual(['main', 'backup', 'backup', 'main']);
  });
});
