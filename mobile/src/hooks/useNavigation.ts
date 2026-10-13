import { RecordingPresets, requestRecordingPermissionsAsync, useAudioRecorder } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  currentPosition,
  distanceMeters,
  requestRoute,
  watchPosition,
  type LatLon,
  type NavigationPlan,
  type Spoken,
} from '../lib/navigation';
import { setRecordingMode, speakDescription } from '../lib/speech';

// GPS ±5–15 м тул эргэлтийг арай эрт анхааруулж, ойртоход "одоо" гэнэ.
const ANNOUNCE_METERS = 60;
const TURN_NOW_METERS = 15;
const ARRIVED_METERS = 15;

/**
 * Явган чиглүүлэг: товчийг дарж байгаад газраа хэлнэ → батлахыг асууна → эргэлт бүрийг хэлнэ.
 * shortcut: замаас хазайвал дахин маршрут гаргадаггүй — бодит хэрэглээнд нэмнэ.
 */
const say = ({ text, audio }: Spoken) => speakDescription(text, audio);

export function useNavigation() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [pending, setPending] = useState<NavigationPlan | null>(null);
  const [active, setActive] = useState(false);
  const [message, setMessage] = useState('');
  const stopWatch = useRef<(() => void) | null>(null);

  const startListening = useCallback(async () => {
    const { granted } = await requestRecordingPermissionsAsync();
    if (!granted) return setMessage('Микрофоны зөвшөөрөл өгнө үү.');
    await setRecordingMode(true);
    await recorder.prepareToRecordAsync();
    recorder.record();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setMessage('Сонсож байна…');
  }, [recorder]);

  const finishListening = useCallback(async () => {
    if (!recorder.isRecording) return;
    await recorder.stop();
    await setRecordingMode(false);
    const uri = recorder.uri;
    if (!uri) return;
    setMessage('Маршрут хайж байна…');
    try {
      const plan = await requestRoute(uri, await currentPosition());
      setMessage(plan.confirm.text);
      setPending(plan.found ? plan : null);
      await say(plan.confirm);
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Алдаа гарлаа.';
      setMessage(text);
      await speakDescription(text);
    }
  }, [recorder]);

  const stop = useCallback(() => {
    stopWatch.current?.();
    stopWatch.current = null;
    setActive(false);
  }, []);

  const start = useCallback(() => {
    const plan = pending;
    if (!plan?.path?.length || !plan.start || !plan.arrive) return;
    const arrive = plan.arrive;
    const maneuvers = plan.maneuvers ?? [];
    const destination: LatLon = { lat: plan.path[plan.path.length - 1][0], lon: plan.path[plan.path.length - 1][1] };
    let next = 0;
    let announced = false;
    setPending(null);
    setActive(true);
    setMessage(plan.start.text);
    void say(plan.start);
    stopWatch.current = watchPosition(plan.path, (position) => {
      const turn = maneuvers[next];
      if (turn) {
        const meters = distanceMeters(position, turn);
        if (!announced && meters <= ANNOUNCE_METERS && meters > TURN_NOW_METERS * 2) {
          announced = true;
          void say(turn.announce);
        } else if (meters <= TURN_NOW_METERS) {
          next += 1;
          announced = false;
          setMessage(turn.now.text);
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          void say(turn.now);
        }
      } else if (distanceMeters(position, destination) <= ARRIVED_METERS) {
        setMessage(arrive.text);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        void say(arrive);
        stop();
      }
    });
  }, [pending, stop]);

  useEffect(() => stop, [stop]);

  return { pending, active, message, startListening, finishListening, start, stop };
}
