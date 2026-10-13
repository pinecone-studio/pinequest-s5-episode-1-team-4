import { fetch } from 'expo/fetch';

// Кадр ирэхгүй бол урсгал гацсан гэж үзээд хаана — апп ганц кадрын хүсэлт рүү шилжинэ.
const STALL_MS = 2_000;
// Wi-Fi удаан үед кадрууд замдаа дараалж хоцролт өссөөр байдаг — хэтэрвэл дахин холбогдож хуучныг хаяна.
const MAX_LAG_MS = 500;

let latest: { jpeg: Uint8Array; at: number } | null = null;

/** Урсгалын хамгийн сүүлийн кадр, `maxAgeMs`-ээс хуучин бол null. */
export function latestStreamFrame(maxAgeMs: number): Uint8Array | null {
  return latest && Date.now() - latest.at <= maxAgeMs ? latest.jpeg : null;
}

type Part = { jpeg: Uint8Array; capturedMs: number | null; rest: Uint8Array };

/** Бүрэн JPEG (FFD8…FFD9) ба өмнөх толгой дахь X-Timestamp-ийг салгана; ESP32-ийн JPEG дотор FFD9 өөр газар гардаггүй. */
function takePart(buffer: Uint8Array): Part | null {
  let start = -1;
  for (let i = 0; i < buffer.length - 1; i++) {
    if (buffer[i] !== 0xff) continue;
    if (start < 0 && buffer[i + 1] === 0xd8) start = i;
    else if (start >= 0 && buffer[i + 1] === 0xd9) {
      const stamp = /X-Timestamp: (\d+)/.exec(String.fromCharCode(...buffer.subarray(0, start)));
      return {
        jpeg: buffer.slice(start, i + 2),
        capturedMs: stamp ? Number(stamp[1]) : null,
        rest: buffer.slice(i + 2),
      };
    }
  }
  return null;
}

function concat(a: Uint8Array, b: Uint8Array) {
  const joined = new Uint8Array(a.length + b.length);
  joined.set(a);
  joined.set(b, a.length);
  return joined;
}

/** MJPEG урсгалын кадр бүрийг `onFrame`-д, дуусах, гацахад `onEnd`. Буцаасан функц урсгалыг хаана. */
export function openCameraStream(url: string, onFrame: (jpeg: Uint8Array) => void, onEnd: () => void) {
  let controller = new AbortController();
  let closed = false;

  const run = async () => {
    const abort = () => controller.abort();
    let watchdog = setTimeout(abort, STALL_MS);
    let lagged = false;
    // Камер, утасны цаг өөр — хамгийн хурдан ирсэн кадрын хугацааг суурь болгож, хуримтлагдсан хоцролтыг хэмжинэ.
    let fastest = Infinity;
    try {
      const response = await fetch(url, { signal: controller.signal });
      const reader = response.body?.getReader();
      let buffer: Uint8Array = new Uint8Array(0);
      while (reader && !lagged) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer = concat(buffer, value);
        for (let part = takePart(buffer); part && !lagged; part = takePart(buffer)) {
          buffer = part.rest;
          clearTimeout(watchdog);
          watchdog = setTimeout(abort, STALL_MS);
          if (part.capturedMs !== null) {
            const delay = Date.now() - part.capturedMs;
            fastest = Math.min(fastest, delay);
            lagged = delay - fastest > MAX_LAG_MS;
          }
          if (lagged) break;
          latest = { jpeg: part.jpeg, at: Date.now() };
          onFrame(part.jpeg);
        }
      }
    } catch {
      // Хаасан эсвэл тасарсан — onEnd-ээр мэдэгдэнэ.
    } finally {
      clearTimeout(watchdog);
      latest = null;
      if (lagged && !closed) {
        controller.abort();
        controller = new AbortController();
        void run();
      } else {
        onEnd();
      }
    }
  };

  void run();
  return () => {
    closed = true;
    controller.abort();
  };
}
