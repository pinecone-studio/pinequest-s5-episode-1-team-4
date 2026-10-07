import { describe, expect, it } from 'vitest';

import { ChimegeSynthesizer, splitForTts } from '../src/speech';
import { joinWavs } from '../src/wav';
import { makeWav } from './helpers';

function makeSynthesizer(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => handler(String(input), init ?? {})) as typeof fetch;
  return new ChimegeSynthesizer({ chimegeToken: 't', chimegeVoiceId: 'v', chimegeSpeed: 1 }, fetchFn);
}

describe('long text', () => {
  it('synthesizes in parts, in parallel, and joins them in order', async () => {
    let call = 0;
    const synthesizer = makeSynthesizer(async (url, init) => {
      if (url.endsWith('/normalize-text')) return new Response(init.body as string);
      const part = call++;
      // Эхний хэсгүүд удаан ирнэ — дараалал алдагдах ёсгүй.
      await new Promise((resolve) => setTimeout(resolve, (5 - part) * 5));
      return new Response(makeWav(new Uint8Array([part + 1, 0])));
    });

    const audio = await synthesizer.synthesize('Таны урд хаалга байна. '.repeat(40));
    const frames = [...audio!.subarray(44)].filter((_, i) => i % 2 === 0);
    expect(call).toBeGreaterThan(1);
    expect(frames).toEqual(Array.from({ length: call }, (_, i) => i + 1));
  });
});

describe('splitForTts', () => {
  it('keeps chunks under the limit on sentence boundaries', () => {
    expect(splitForTts('Таны урд хаалга байна. Зүүн талд шат байна. Баруун талд машин байна.', 45)).toEqual([
      'Таны урд хаалга байна. Зүүн талд шат байна.',
      'Баруун талд машин байна.',
    ]);
  });

  it('breaks an overlong sentence by words', () => {
    const chunks = splitForTts('аа '.repeat(30), 20);
    expect(chunks.every((chunk) => chunk.length > 0 && chunk.length <= 20)).toBe(true);
    expect(chunks.join(' ').split(' ')).toEqual(Array(30).fill('аа'));
  });
});

describe('joinWavs', () => {
  it('passes a single part through, returns null for nothing and rejects non-WAV data', () => {
    const wav = makeWav(new Uint8Array([1, 2]));
    expect(joinWavs([wav])).toBe(wav);
    expect(joinWavs([])).toBeNull();
    expect(() => joinWavs([new Uint8Array([1]), new Uint8Array([2])])).toThrow();
  });
});
