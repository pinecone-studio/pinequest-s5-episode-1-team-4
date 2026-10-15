import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { streamSSE } from 'hono/streaming';

import type { Settings } from '../config';
import type { EventHub } from '../events';
import type { ErrorResponse } from '../schemas';

// Fly proxy чимээгүй холболтыг ~60 сек-д тасалдаг.
const PING_MS = 15_000;
const MAX_EVENT_BYTES = 2 * 1024 * 1024;

/** GET — демо хуудас сонсоно. POST — laptop backend token-оор үйл явдлаа илгээнэ. */
export function eventRoutes(settings: Settings, hub: EventHub) {
  return new Hono()
    .get('/events', (c) =>
      streamSSE(c, async (stream) => {
        const unsubscribe = hub.subscribe((data) => stream.writeSSE({ data }));
        stream.onAbort(unsubscribe);
        while (!stream.aborted) {
          await stream.sleep(PING_MS);
          await stream.writeSSE({ event: 'ping', data: '' });
        }
      }),
    )
    .post('/events', bodyLimit({ maxSize: MAX_EVENT_BYTES }), async (c) => {
      if (!settings.eventsToken || c.req.header('authorization') !== `Bearer ${settings.eventsToken}`) {
        return c.json<ErrorResponse>({ detail: 'Token буруу.' }, 401);
      }
      hub.broadcast(await c.req.text(), c.req.header('x-droppable') === 'true');
      return c.body(null, 204);
    });
}
