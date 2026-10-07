import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { loadSettings } from '../src/config';
import { GeminiSceneAnalyzer, READ_INSTRUCTIONS, type AnalysisRequest } from '../src/vision';

describe('POST /api/v1/read', () => {
  it('reads the text aloud in read mode', async () => {
    const modes: (string | undefined)[] = [];
    const analyzer = {
      analyze: async (_image: Uint8Array, _type: string, request?: AnalysisRequest) => {
        modes.push(request?.mode);
        return 'Парацетамол 500 мг.';
      },
    };
    const speech = { synthesize: async () => new TextEncoder().encode('RIFF-wav') };
    const form = new FormData();
    form.append('image', new File(['jpeg-bytes'], 'a.jpg', { type: 'image/jpeg' }));

    const response = await createApp({ settings: loadSettings({}), analyzer, speech }).request('/api/v1/read', {
      method: 'POST',
      body: form,
    });

    expect(await response.json()).toEqual({ description: 'Парацетамол 500 мг.', audio_base64: 'UklGRi13YXY=' });
    expect(modes).toEqual(['read']);
  });
});

describe('read mode prompt', () => {
  it('sends the read instructions with a larger answer budget', async () => {
    const calls: any[] = [];
    const client = { models: { generateContent: async (p: unknown) => (calls.push(p), { text: 'Бичиг.' }) } };
    const settings = { geminiApiKey: 'k', geminiModel: 'm', geminiFallbackModels: [], geminiWalkModel: 'w', geminiWalkAlternates: [] };

    await new GeminiSceneAnalyzer(settings, () => client as any).analyze(new Uint8Array([1]), 'image/jpeg', { mode: 'read' });

    expect(calls[0].config.systemInstruction).toBe(READ_INSTRUCTIONS);
    expect(calls[0].config.maxOutputTokens).toBe(4096);
  });
});
