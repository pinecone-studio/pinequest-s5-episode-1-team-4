import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { sleep, withTimeout } from '../lib/async';
import { playPhrase, stopSpeaking } from '../lib/speech';
import type { FrameSource } from '../lib/walkCapture';
import { WalkSession } from '../lib/walkSession';

// YOLO ~0.1 сек тул 1.2 сек тутам шинэ кадр шалгана.
const FAST_CYCLE_MS = 1_200;
// Алдаа гарсны дараа илүү удаан хүлээнэ.
const RETRY_DELAY_MS = 4_000;
const MAX_CONSECUTIVE_FAILURES = 3;
// Камер хариу өгөхгүй гацвал давталт чимээгүй зогсох ёсгүй — алдаа гэж тооцно.
const CAPTURE_TIMEOUT_MS = 8_000;
const KEEP_AWAKE_TAG = 'walking-mode';

const STOP_FEEDBACK = {
  'walk-off': Haptics.NotificationFeedbackType.Warning,
  'walk-error': Haptics.NotificationFeedbackType.Error,
};

async function runCycle(session: WalkSession, captureFrame: FrameSource) {
  const frame = await withTimeout(captureFrame(), CAPTURE_TIMEOUT_MS, 'Камер хариу өгсөнгүй.');
  if (!frame) throw new Error('Зураг авч чадсангүй.');
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
  // Өсгөх бүрд ажиллаж буй давталт зогсоно.
  const runId = useRef(0);

  const stop = useCallback(async (phrase: keyof typeof STOP_FEEDBACK = 'walk-off') => {
    runId.current += 1;
    setActive(false);
    await stopSpeaking();
    void Haptics.notificationAsync(STOP_FEEDBACK[phrase]);
    await playPhrase(phrase);
  }, []);

  const start = useCallback(async () => {
    const id = ++runId.current;
    const isCurrent = () => runId.current === id;
    setActive(true);
    setLastDescription('');
    setError('');
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await playPhrase('walk-on');

    const session = new WalkSession({ onSpoken: setLastDescription, isCurrent });
    let failures = 0;
    while (isCurrent()) {
      const started = Date.now();
      const cause = await runCycle(session, captureFrame).then(() => null, (e: unknown) => e ?? 'error');
      if (!isCurrent()) return;
      failures = cause ? failures + 1 : 0;
      setError(errorText(cause));
      if (failures >= MAX_CONSECUTIVE_FAILURES) return stop('walk-error');
      await sleep((cause ? RETRY_DELAY_MS : FAST_CYCLE_MS) - (Date.now() - started));
    }
  }, [captureFrame, stop]);

  useEffect(() => {
    if (!active) return;
    // Дэлгэц унтарвал, апп background руу орвол камер зогсдог.
    void activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    const subscription = AppState.addEventListener('change', (state) => state !== 'active' && void stop());
    return () => {
      subscription.remove();
      void deactivateKeepAwake(KEEP_AWAKE_TAG);
    };
  }, [active, stop]);

  // Дэлгэц солигдоход ажиллаж буй давталтыг зогсооно.
  useEffect(() => () => void (runId.current += 1), []);

  return { active, lastDescription, error, start, stop };
}
