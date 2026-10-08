import { describe, expect, it } from 'vitest';

import { ChimegeSynthesizer } from '../src/speech';

const SETTINGS: ConstructorParameters<typeof ChimegeSynthesizer>[0] = {
  chimegeToken: 'test-token',
  chimegeVoiceId: 'MALE1v2',
  chimegeSpeed: 1,
};
const WAV = new TextEncoder().encode('RIFF-wav');
type Handler = (url: string, init: RequestInit) => Response;

function makeSynthesizer(handler: Handler, settings = SETTINGS) {
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => handler(String(input), init ?? {})) as typeof fetch;
  return new ChimegeSynthesizer(settings, fetchFn);
}

const header = (init: RequestInit, name: string) => (init.headers as Record<string, string>)[name];

describe('ChimegeSynthesizer', () => {
  it('normalizes the text, then synthesizes it', async () => {
    const requests: [string, RequestInit][] = [];
    const synthesizer = makeSynthesizer((url, init) => {
      requests.push([url, init]);
      return url.endsWith('/normalize-text') ? new Response('Урд хоёр хаалга байна.') : new Response(WAV);
    });

    const audio = await synthesizer.synthesize('Урд 2 хаалга байна.');

    expect(audio).toEqual(WAV);
    const [[normalizeUrl, normalize], [synthesizeUrl, synthesize]] = requests;
    expect(normalizeUrl).toBe('https://api.chimege.com/v1.2/normalize-text');
    expect(header(normalize, 'Token')).toBe('test-token');
    expect(synthesizeUrl).toBe('https://api.chimege.com/v1.2/synthesize');
    expect(header(synthesize, 'voice-id')).toBe('MALE1v2');
    expect(synthesize.body).toBe('Урд хоёр хаалга байна.');
  });

  it('skips normalization for plain Cyrillic alerts and strips unreadable characters', async () => {
    const bodies: unknown[] = [];
    const synthesizer = makeSynthesizer((_url, init) => {
      bodies.push(init.body);
      return new Response(WAV);
    });

    await synthesizer.synthesize('Урд WC тэмдэг — байна.', { normalize: false });

    expect(bodies).toEqual(['Урд тэмдэг байна.']);
  });

  it.each([
    ['without a token', () => new Response(WAV), { ...SETTINGS, chimegeToken: undefined }],
    ['when the API fails', () => new Response('error', { status: 500 }), SETTINGS],
  ])('returns null %s so the app falls back to device speech', async (_name, handler, settings) => {
    expect(await makeSynthesizer(handler, settings).synthesize('Сайн байна уу.')).toBeNull();
  });
});
