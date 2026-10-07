import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { AlertAudioCache } from '../src/alertAudio';
import type { SpeechSynthesizer, SynthesizeOptions } from '../src/speech';

class CountingSynthesizer implements SpeechSynthesizer {
  calls: { text: string; options?: SynthesizeOptions }[] = [];

  async synthesize(text: string, options?: SynthesizeOptions) {
    this.calls.push({ text, options });
    await new Promise((resolve) => setTimeout(resolve, 5));
    return new TextEncoder().encode(`wav:${text}`);
  }
}

const decode = (base64: string | null) => (base64 ? Buffer.from(base64, 'base64').toString() : null);

describe('AlertAudioCache', () => {
  it('synthesizes once, without normalization, even for concurrent requests', async () => {
    const synthesizer = new CountingSynthesizer();
    const cache = new AlertAudioCache(synthesizer, 'voice', null);

    const [a, b] = await Promise.all([cache.get('Урд хүн байна.'), cache.get('Урд хүн байна.')]);
    const c = await cache.get('Урд хүн байна.');

    expect(decode(a)).toBe('wav:Урд хүн байна.');
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(synthesizer.calls).toEqual([{ text: 'Урд хүн байна.', options: { normalize: false } }]);
  });

  it('keeps audio on disk across restarts and per voice', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'alert-audio-'));
    await new AlertAudioCache(new CountingSynthesizer(), 'voice-a', dir).get('Урд машин байна.');

    const restarted = new CountingSynthesizer();
    const audio = await new AlertAudioCache(restarted, 'voice-a', dir).get('Урд машин байна.');
    const otherVoice = new CountingSynthesizer();
    await new AlertAudioCache(otherVoice, 'voice-b', dir).get('Урд машин байна.');

    expect(decode(audio)).toBe('wav:Урд машин байна.');
    expect(restarted.calls).toHaveLength(0);
    expect(otherVoice.calls).toHaveLength(1);
    expect(readdirSync(dir)).toHaveLength(2);
  });

  it('prewarms only what is missing', async () => {
    const synthesizer = new CountingSynthesizer();
    const cache = new AlertAudioCache(synthesizer, 'voice', null);
    await cache.get('Урд хүн байна.');

    const created = await cache.prewarm(['Урд хүн байна.', 'Урд дугуй байна.']);

    expect(created).toBe(1);
    expect(synthesizer.calls.map((call) => call.text)).toEqual(['Урд хүн байна.', 'Урд дугуй байна.']);
  });
});
