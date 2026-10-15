import { File, Paths } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useRef, useState } from 'react';

import { deletePhoto } from '../lib/api';
import { sleep, withTimeout } from '../lib/async';
import { latestDistanceCm } from '../lib/cameraStream';
import { ObstacleSense, SENSOR_MAX_AGE_MS } from '../lib/obstacle';
import { PRIORITY } from '../lib/prioritySpeaker';
import { keepAliveInBackground, playPhrase, speakDescription, stopSpeaking } from '../lib/speech';
import type { FrameSource } from '../lib/walkCapture';
import { WalkSession } from '../lib/walkSession';

// Кадр авах ~0.2 сек, илрүүлэх ~0.25 сек — 0.6 сек тутам шалгахад саад гарч ирснээс
// хэлэх хүртэл хамгийн ихдээ ~1 сек. 1.2 сек байхад шинэ саадыг 0.6 сек хүртэл хүлээж байсан.
const FAST_CYCLE_MS = 600;
// Алдаа гарсны дараа илүү удаан хүлээнэ.
const RETRY_DELAY_MS = 4_000;
const MAX_CONSECUTIVE_FAILURES = 3;
// Камер хариу өгөхгүй гацвал давталт чимээгүй зогсох ёсгүй — алдаа гэж тооцно.
const CAPTURE_TIMEOUT_MS = 8_000;
const KEEP_AWAKE_TAG = 'walking-mode';
// Мэдрэгчийн зайг кадрын давталтаас (0.6+ сек) тусад нь, хурдан шалгана.
const SENSOR_CHECK_MS = 100;

const STOP_FEEDBACK = {
  'walk-off': Haptics.NotificationFeedbackType.Warning,
  'walk-error': Haptics.NotificationFeedbackType.Error,
};

/** Кадрын хуулбар — урьдчилан харах дүрс камерт тусдаа хүсэлт явуулахгүй (ESP32 нэг удаад нэгийг үйлчилнэ). */
function previewCopy(uri: string) {
  const copy = new File(Paths.cache, `walk-preview-${Date.now()}.jpg`);
  new File(uri).copySync(copy);
  return copy.uri;
}

async function runCycle(session: WalkSession, captureFrame: FrameSource, show: (uri: string) => void) {
  const frame = await withTimeout(captureFrame(), CAPTURE_TIMEOUT_MS, 'Камер хариу өгсөнгүй.');
  if (!frame) throw new Error('Зураг авч чадсангүй.');
  show(previewCopy(frame.uri));
  await session.inspect(frame);
}

const errorText = (cause: unknown) =>
  cause instanceof Error ? cause.message : cause ? 'Алдаа гарлаа.' : '';

/**
 * Алхах горим, хоёр давхарга:
 * - YOLO+OWL (1.2 сек тутам): хүн, машин, хаалга гарч ирвэл шууд хэлнэ.
 * - Gemini (дүрс өөрчлөгдөх эсвэл 6 сек тутам): шат, тоосго зэргийг тайлбарлана.
 */
export function useWalkingMode(captureFrame: FrameSource) {
  const [active, setActive] = useState(false);
  const [lastDescription, setLastDescription] = useState('');
  const [error, setError] = useState('');
  const [frameUri, setFrameUri] = useState<string>();
  // Өсгөх бүрд ажиллаж буй давталт зогсоно.
  const runId = useRef(0);
  const sessionRef = useRef<WalkSession | null>(null);
  // Унших, тайлбарлах үед давталт түр зогсож, дараа нь өөрөө үргэлжилнэ.
  const suspended = useRef(false);

  const stop = useCallback(async (phrase: keyof typeof STOP_FEEDBACK = 'walk-off') => {
    runId.current += 1;
    setActive(false);
    void keepAliveInBackground(false);
    await stopSpeaking();
    void Haptics.notificationAsync(STOP_FEEDBACK[phrase]);
    await playPhrase(phrase);
  }, []);

  const start = useCallback(async () => {
    const id = ++runId.current;
    const isCurrent = () => runId.current === id && !suspended.current;
    const isRunning = () => runId.current === id;
    setActive(true);
    setLastDescription('');
    setError('');
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await playPhrase('walk-on');
    void keepAliveInBackground(true);

    const session = new WalkSession({ onSpoken: setLastDescription, isCurrent });
    sessionRef.current = session;
    const obstacles = new ObstacleSense();
    const sensing = setInterval(() => {
      if (!isRunning()) return clearInterval(sensing);
      if (suspended.current) return;
      const now = Date.now();
      obstacles.check(latestDistanceCm(SENSOR_MAX_AGE_MS), now, ({ phrase, text, priority }) =>
        session.say(text, priority, () => playPhrase(phrase)),
      );
    }, SENSOR_CHECK_MS);
    let shown: string | undefined;
    const show = (uri: string) => {
      if (shown) deletePhoto(shown);
      shown = uri;
      setFrameUri(uri);
    };
    let failures = 0;
    while (isRunning()) {
      if (suspended.current) {
        await sleep(200);
        continue;
      }
      const started = Date.now();
      const cause = await runCycle(session, captureFrame, show).then(() => null, (e: unknown) => e ?? 'error');
      if (!isRunning()) return;
      failures = cause ? failures + 1 : 0;
      setError(errorText(cause));
      if (failures >= MAX_CONSECUTIVE_FAILURES) return stop('walk-error');
      await sleep((cause ? RETRY_DELAY_MS : FAST_CYCLE_MS) - (Date.now() - started));
    }
  }, [captureFrame, stop]);

  useEffect(() => {
    if (!active) return;
    // Нээлттэй үед дэлгэц өөрөө түгжигдэхгүй; хэрэглэгч түгжвэл ESP32 камер, чимээгүй дуугаар үргэлжилнэ.
    void activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    return () => void deactivateKeepAwake(KEEP_AWAKE_TAG);
  }, [active]);

  // Дэлгэц солигдоход ажиллаж буй давталтыг зогсооно.
  useEffect(
    () => () => {
      runId.current += 1;
      void keepAliveInBackground(false);
    },
    [],
  );

  const suspend = useCallback((on: boolean) => void (suspended.current = on), []);

  /** Чиглүүлгийн заавар: алхах горим ажиллаж байвал сэрэмжлүүлэгтэй ээлжилнэ. Хэлээгүй бол false. */
  const announce = useCallback(
    (text: string, audio: string | null) => {
      const session = active ? sessionRef.current : null;
      if (session) return session.say(text, PRIORITY.navigation, () => speakDescription(text, audio));
      void speakDescription(text, audio);
      return true;
    },
    [active],
  );

  return { active, lastDescription, error, frameUri, start, stop, suspend, announce };
}
