import { Buffer } from 'node:buffer';

/**
 * Демо дэлгэц: backend-ийн харсан, хэлсэн зүйлийг SSE-ээр дамжуулна. Танхимын проектор утасны
 * hotspot-д холбогдохгүй тул laptop backend үйл явдлаа Fly руу илгээж, хуудас Fly-аас уншина.
 */
export type DemoEvent =
  | {
      type: 'frame';
      image: string;
      boxes: { name: string; box: number[]; close: boolean }[];
      alert: string | null;
      ms: number;
    }
  | { type: 'speech'; mode: 'walk' | 'read' | 'scene' | 'voice'; text: string; image?: string };

type Listener = { send: (data: string) => Promise<unknown>; busy: boolean };

export const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

export class EventHub {
  private listeners = new Set<Listener>();
  private forwarding = false;

  constructor(private relay?: { url: string; token: string }) {}

  /** Хэн ч харахгүй бол зураг base64 болгох ажлыг алгасна. */
  get watched() {
    return this.listeners.size > 0 || Boolean(this.relay);
  }

  publish(event: DemoEvent) {
    this.broadcast(JSON.stringify({ ...event, at: Date.now() }), event.type === 'frame');
  }

  /** Кадр хоцрохоор алгасна — өгүүлбэрийг заавал хүргэнэ. */
  broadcast(data: string, droppable: boolean) {
    for (const listener of this.listeners) {
      if (droppable && listener.busy) continue;
      listener.busy = true;
      void listener.send(data).finally(() => (listener.busy = false));
    }
    if (this.relay && !(droppable && this.forwarding)) void this.forward(data, droppable);
  }

  subscribe(send: (data: string) => Promise<unknown>): () => void {
    const listener = { send, busy: false };
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async forward(data: string, droppable: boolean) {
    if (droppable) this.forwarding = true;
    try {
      await fetch(this.relay!.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.relay!.token}`, 'Content-Type': 'application/json', 'X-Droppable': String(droppable) },
        body: data,
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      // Демо дэлгэц тасарсан ч утасны ажилд нөлөөлөхгүй.
    } finally {
      if (droppable) this.forwarding = false;
    }
  }
}
