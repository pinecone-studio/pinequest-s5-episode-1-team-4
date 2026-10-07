/** Тестэд зориулсан хамгийн энгийн PCM WAV (22050 Hz, mono, 16-bit). */
export function makeWav(frames: Uint8Array): Uint8Array {
  const wav = new Uint8Array(44 + frames.length);
  const view = new DataView(wav.buffer);
  for (const [offset, text] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']] as const) {
    wav.set([...text].map((char) => char.charCodeAt(0)), offset);
  }
  for (const [offset, value] of [[4, 36 + frames.length], [16, 16], [24, 22050], [28, 44100], [40, frames.length]]) {
    view.setUint32(offset, value, true);
  }
  for (const [offset, value] of [[20, 1], [22, 1], [32, 2], [34, 16]]) view.setUint16(offset, value, true);
  wav.set(frames, 44);
  return wav;
}
