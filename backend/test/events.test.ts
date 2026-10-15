import { describe, expect, it } from 'vitest';

import { AlertAudioCache } from '../src/alertAudio';
import { createApp } from '../src/app';
import { loadSettings } from '../src/config';
import { HazardDetector } from '../src/detector';
import { EventHub } from '../src/events';
import type { Box } from '../src/yolo';

const speech = { synthesize: async () => new TextEncoder().encode('RIFF-wav') };

function app(events: EventHub, env: Record<string, string> = {}) {
  const person = { label: 'person', score: 0.9, box: [0.4, 0.2, 0.6, 0.6] as Box };
  const detector = new HazardDetector([{ detectObjects: async () => [person] }]);
  const alertAudio = new AlertAudioCache(speech, 'voice', null);
  return createApp({ settings: loadSettings(env), speech, detector, alertAudio, events });
}

describe('demo events', () => {
  it('sends each detected frame with its boxes to watchers', async () => {
    const events = new EventHub();
    const received: string[] = [];
    events.subscribe(async (data) => received.push(data));
    const form = new FormData();
    form.append('image', new File(['jpeg-bytes'], 'a.jpg', { type: 'image/jpeg' }));

    await app(events).request('/api/v1/detect', { method: 'POST', body: form });

    expect(JSON.parse(received[0])).toMatchObject({
      type: 'frame',
      image: btoa('jpeg-bytes'),
      boxes: [{ name: 'хүн', box: [0.4, 0.2, 0.6, 0.6] }],
      alert: 'Урд хүн байна.',
    });
  });

  it('relays posted events only with the right token', async () => {
    const events = new EventHub();
    const received: string[] = [];
    events.subscribe(async (data) => received.push(data));
    const relay = app(events, { EVENTS_TOKEN: 'secret' });
    const post = (token: string) =>
      relay.request('/api/v1/events', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: '{"type":"speech"}' });

    expect((await post('wrong')).status).toBe(401);
    expect((await post('secret')).status).toBe(204);
    expect(received).toEqual(['{"type":"speech"}']);
  });

  it('skips a frame while the watcher is still receiving the previous one', () => {
    const events = new EventHub();
    let sent = 0;
    events.subscribe(() => (sent++, new Promise(() => {})));

    events.broadcast('frame-1', true);
    events.broadcast('frame-2', true);
    events.broadcast('speech', false);

    expect(sent).toBe(2);
  });
});
