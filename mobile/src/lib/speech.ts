import { createAudioPlayer, setAudioModeAsync, type AudioPlayer, type AudioSource } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import * as Speech from 'expo-speech';
import { Platform } from 'react-native';

// Чимэгэ-ээр урьдчилан бичсэн тогтмол мессежүүд — интернэтгүй ч Монголоор сонсогдоно.
const PHRASES = {
  'walk-on': require('../../assets/audio/walk-on.wav'),
  'walk-off': require('../../assets/audio/walk-off.wav'),
  'walk-error': require('../../assets/audio/walk-error.wav'),
} as const;

export type Phrase = keyof typeof PHRASES;

// finish event ирэхгүй тохиолдолд тоглуулалт дууссанд тооцох хугацаа.
const MAX_PLAYBACK_MS = 30_000;
const DEVICE_RATE = Platform.select({ ios: 0.48, default: 0.9 });

let player: AudioPlayer | null = null;
let currentFile: File | null = null;
let finishPlayback: (() => void) | null = null;
let audioModeReady: Promise<void> | null = null;

// Утас чимээгүй горимд байсан ч тайлбар заавал сонсогдох ёстой.
function ensureAudioMode(): Promise<void> {
  audioModeReady ??= setAudioModeAsync({
    playsInSilentMode: true,
    interruptionMode: 'duckOthers',
  }).catch(() => undefined);
  return audioModeReady;
}

function settlePlayback() {
  const done = finishPlayback;
  finishPlayback = null;
  done?.();
}

function getPlayer(): AudioPlayer {
  if (player) return player;
  player = createAudioPlayer(null);
  player.addListener('playbackStatusUpdate', (status) => {
    if (status.didJustFinish) settlePlayback();
  });
  return player;
}

/** Дуу тоглуулж, дуусах эсвэл зогсоох хүртэл хүлээнэ. */
function play(source: AudioSource): Promise<void> {
  const audio = getPlayer();
  audio.replace(source);
  return new Promise((resolve) => {
    finishPlayback = resolve;
    audio.play();
    setTimeout(() => finishPlayback === resolve && settlePlayback(), MAX_PLAYBACK_MS);
  });
}

function playWav(audioBase64: string): Promise<void> {
  const file = new File(Paths.cache, `visionmate-${Date.now()}.wav`);
  file.create({ overwrite: true });
  file.write(audioBase64, { encoding: 'base64' });
  const playback = play({ uri: file.uri });
  // Өмнөх дууны файлыг устгаж cache дүүргэхгүй.
  if (currentFile?.exists) currentFile.delete();
  currentFile = file;
  return playback;
}

function speakWithDevice(text: string): Promise<void> {
  return new Promise((resolve) => {
    // onDone ирэхгүй тохиолдолд дараагийн яриа гацахгүйн тулд.
    setTimeout(resolve, MAX_PLAYBACK_MS);
    Speech.speak(text, {
      language: 'mn-MN',
      rate: DEVICE_RATE,
      onDone: resolve,
      onStopped: resolve,
      onError: () => resolve(),
    });
  });
}

export async function stopSpeaking(): Promise<void> {
  player?.pause();
  settlePlayback();
  await Speech.stop();
}

/**
 * Backend-ээс ирсэн Чимэгэ-ийн Монгол дууг тоглуулна. Дуу ирээгүй эсвэл тоглуулж
 * чадаагүй бол төхөөрөмжийн TTS-ээр уншина. Уншиж дуусахад resolve болно.
 */
export async function speakDescription(text: string, audioBase64?: string | null) {
  await stopSpeaking();
  await ensureAudioMode();
  const played = audioBase64 ? await playWav(audioBase64).then(() => true, () => false) : false;
  if (!played) await speakWithDevice(text);
}

/** Аппад суулгасан дууг тоглуулна — интернэтгүй ч ажиллана. */
export async function playAudio(source: AudioSource): Promise<void> {
  await stopSpeaking();
  await ensureAudioMode();
  // Тогтмол мессеж тоглохгүй байсан ч үндсэн ажлыг зогсоохгүй.
  await play(source).catch(() => undefined);
}

export function playPhrase(phrase: Phrase): Promise<void> {
  return playAudio(PHRASES[phrase]);
}
