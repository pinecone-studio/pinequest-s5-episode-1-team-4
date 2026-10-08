type WavChunks = { fmt: Uint8Array; data: Uint8Array };
function ascii(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

function readWav(bytes: Uint8Array): WavChunks {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const isWav = bytes.length >= 12 && ascii(bytes, 0) === 'RIFF' && ascii(bytes, 8) === 'WAVE';
  const chunks = new Map<string, Uint8Array>();
  for (let offset = 12; isWav && offset + 8 <= bytes.length; ) {
    const size = view.getUint32(offset + 4, true);
    chunks.set(ascii(bytes, offset), bytes.subarray(offset + 8, offset + 8 + size));
    offset += 8 + size + (size % 2);
  }
  const fmt = chunks.get('fmt ');
  const data = chunks.get('data');
  if (!fmt || !data) throw new Error('WAV формат биш эсвэл fmt/data хэсэг алга.');
  return { fmt, data };
}

/** Ижил форматтай хэд хэдэн WAV-ийг нэг WAV болгож нийлүүлнэ. */
export function joinWavs(parts: Uint8Array[]): Uint8Array | null {
  const nonEmpty = parts.filter((part) => part.length > 0);
  if (nonEmpty.length <= 1) return nonEmpty[0] ?? null;
  const wavs = nonEmpty.map(readWav);
  const { fmt } = wavs[0];
  const dataSize = wavs.reduce((sum, wav) => sum + wav.data.length, 0);
  const output = new Uint8Array(12 + 8 + fmt.length + 8 + dataSize);
  const view = new DataView(output.buffer);
  const writeAscii = (offset: number, text: string) =>
    output.set([...text].map((char) => char.charCodeAt(0)), offset);
  writeAscii(0, 'RIFF');
  view.setUint32(4, output.length - 8, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, fmt.length, true);
  output.set(fmt, 20);
  const dataHeader = 20 + fmt.length;
  writeAscii(dataHeader, 'data');
  view.setUint32(dataHeader + 4, dataSize, true);
  let offset = dataHeader + 8;
  for (const wav of wavs) {
    output.set(wav.data, offset);
    offset += wav.data.length;
  }
  return output;
}
