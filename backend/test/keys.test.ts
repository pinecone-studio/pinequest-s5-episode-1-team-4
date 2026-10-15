import { ApiError } from '@google/genai';
import { describe, expect, it } from 'vitest';

import { GeminiSceneAnalyzer } from '../src/vision';

const SETTINGS = { geminiModel: 'main', geminiFallbackModels: ['backup'], geminiWalkModel: 'w', geminiWalkAlternates: [] };

describe('Gemini API key rotation', () => {
  it('moves to the next key when one runs out of free quota', async () => {
    const calls: string[] = [];
    const analyzer = new GeminiSceneAnalyzer({ ...SETTINGS, geminiApiKey: 'a', geminiApiKeys: ['b'] }, (key) => ({
      models: {
        generateContent: async ({ model }: { model: string }) => {
          calls.push(`${key}:${model}`);
          if (key === 'a') throw new ApiError({ message: 'quota', status: 429 });
          return { text: 'Урд шат байна.' };
        },
      } as never,
    }));

    expect(await analyzer.analyze(new Uint8Array([1]), 'image/jpeg')).toBe('Урд шат байна.');
    expect(await analyzer.analyze(new Uint8Array([1]), 'image/jpeg')).toBe('Урд шат байна.');
    // Хоёр дахь удаа хязгаарт орсон key-ийг алгасна.
    expect(calls).toEqual(['a:main', 'b:main', 'b:main']);
  });

  it('skips a mistyped key without giving up on the others', async () => {
    const calls: string[] = [];
    const analyzer = new GeminiSceneAnalyzer({ ...SETTINGS, geminiApiKey: 'bad', geminiApiKeys: ['good'] }, (key) => ({
      models: {
        generateContent: async ({ model }: { model: string }) => {
          calls.push(`${key}:${model}`);
          if (key === 'bad') throw new ApiError({ message: 'API key not valid', status: 400 });
          return { text: 'Урд шат байна.' };
        },
      } as never,
    }));

    expect(await analyzer.analyze(new Uint8Array([1]), 'image/jpeg')).toBe('Урд шат байна.');
    expect(calls).toEqual(['bad:main', 'good:main']);
  });
});
