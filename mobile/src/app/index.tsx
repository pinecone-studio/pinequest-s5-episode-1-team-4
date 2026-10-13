import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CameraPreview } from '../components/CameraPreview';
import { useNavigation } from '../hooks/useNavigation';
import { useWalkingMode } from '../hooks/useWalkingMode';
import { analyzeScene, deletePhoto, readText, type SceneAnalysis } from '../lib/api';
import { cameraFrames, captureJpeg, isCameraReachable } from '../lib/camera';
import { sleep } from '../lib/async';
import { speakDescription } from '../lib/speech';
import { colors } from '../theme';

type Task = 'scene' | 'read';

const TASKS: Record<Task, { label: string; busy: string; hiRes: boolean; run(uri: string): Promise<SceneAnalysis> }> = {
  scene: { label: 'Орчноо таних', busy: 'Орчныг шинжилж байна…', hiRes: false, run: analyzeScene },
  // Жижиг бичиг 640px-д уншигдахгүй.
  read: { label: 'Энийг унш', busy: 'Бичгийг уншиж байна…', hiRes: true, run: readText },
};

// Хараагүй хүн товч хайхгүйгээр: дэлгэцийн хаана ч 2 товшвол уншина, 3 товшвол орчноо тайлбарлана.
const TAP_GAP_MS = 400;
const TAP_TASKS: Record<number, Task> = { 2: 'read', 3: 'scene' };
// Тод кадр авахын өмнө урьдчилан харах урсгал хаагдахыг хүлээнэ — эс бөгөөс кадрын хэмжээ солигдож будлина.
const STREAM_CLOSE_MS = 300;

const CAMERA_STATUS = {
  checking: 'Камерыг шалгаж байна…',
  ok: 'Камер холбогдсон',
  missing: 'Камер олдсонгүй. Дарж дахин шалгана.',
};

type ButtonProps = {
  label: string;
  onPress?(): void;
  onPressIn?(): void;
  onPressOut?(): void;
  disabled?: boolean;
  active?: boolean;
};

function BigButton({ label, onPress, onPressIn, onPressOut, disabled = false, active = false }: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, selected: active }}
      disabled={disabled}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={({ pressed }) => [styles.button, active && styles.active, (pressed || disabled) && styles.dim]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

export default function HomeScreen() {
  const [camera, setCamera] = useState<keyof typeof CAMERA_STATUS>('checking');
  const [busy, setBusy] = useState<Task | null>(null);
  const [message, setMessage] = useState('');
  const walking = useWalkingMode(cameraFrames);
  const running = useRef(false);
  const taps = useRef<{ count: number; timer?: ReturnType<typeof setTimeout> }>({ count: 0 });
  const { start: startWalking, suspend: suspendWalking } = walking;
  const navigation = useNavigation();

  const checkCamera = () => {
    setCamera('checking');
    void isCameraReachable().then((ok) => setCamera(ok ? 'ok' : 'missing'));
  };

  // Апп нээгдэж камер олдмогц алхах горим өөрөө асна — товч хайх шаардлагагүй.
  useEffect(() => {
    void isCameraReachable().then((ok) => {
      setCamera(ok ? 'ok' : 'missing');
      if (ok) void startWalking();
    });
  }, [startWalking]);

  function onScreenTap() {
    const tap = taps.current;
    clearTimeout(tap.timer);
    tap.count += 1;
    tap.timer = setTimeout(() => {
      const task = TAP_TASKS[tap.count];
      // Маршрут батлахыг хүлээж байвал 2 товшилт нь уншихын оронд чиглүүлгийг эхлүүлнэ.
      const startsNavigation = tap.count === 2 && navigation.pending !== null;
      tap.count = 0;
      if (startsNavigation) navigation.start();
      else if (task) void runTask(task);
    }, TAP_GAP_MS);
  }

  async function runTask(task: Task) {
    if (running.current) return;
    running.current = true;
    const { busy: busyText, hiRes, run } = TASKS[task];
    suspendWalking(true);
    setBusy(task);
    setMessage(busyText);
    let uri: string | undefined;
    try {
      if (hiRes) await sleep(STREAM_CLOSE_MS);
      uri = await captureJpeg(hiRes);
      const { description, audioBase64 } = await run(uri);
      setMessage(description);
      // Хэлж дуусахад алхах горим үргэлжилнэ.
      await speakDescription(description, audioBase64);
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Алдаа гарлаа.';
      setMessage(text);
      // Хэрэглэгч дэлгэц харахгүй тул алдааг ч дуугаар хэлнэ.
      await speakDescription(text);
    } finally {
      if (uri) deletePhoto(uri);
      setBusy(null);
      suspendWalking(false);
      running.current = false;
    }
  }

  const walkText = walking.error || walking.lastDescription || 'Алхах горим ажиллаж байна.';

  return (
    <SafeAreaView style={styles.screen}>
      <Pressable style={styles.screen} onPress={onScreenTap} accessible={false}>
        <StatusBar style="light" />
        <ScrollView contentContainerStyle={styles.content}>
          <Text accessibilityRole="header" style={styles.title}>
            VisionMate
          </Text>
          <Pressable accessibilityRole="button" disabled={camera === 'checking'} onPress={checkCamera}>
            <Text style={[styles.status, camera === 'missing' && styles.warning]}>{CAMERA_STATUS[camera]}</Text>
          </Pressable>
          {/* Тод кадр авахад урсгал саад болохгүйн тулд шинжилгээний үед зогсоно. Урсгал ажиллахгүй бол
            алхах горимд таних кадрыг харуулна — ESP32 нэг удаад нэг хүсэлт үйлчилдэг. */}
          <CameraPreview paused={busy !== null} walking={walking.active} frameUri={walking.frameUri} />

          {(Object.keys(TASKS) as Task[]).map((task) => (
            <BigButton
              key={task}
              label={TASKS[task].label}
              onPress={() => void runTask(task)}
              disabled={busy !== null}
              active={busy === task}
            />
          ))}
          <BigButton
            label={walking.active ? 'Алхах горимыг зогсоох' : 'Алхах горим'}
            onPress={() => void (walking.active ? walking.stop() : walking.start())}
            disabled={busy !== null}
            active={walking.active}
          />

          {/* Сэрэмжлүүлэг ярихгүйн тулд хэлж байх хооронд алхах горим түр зогсоно. */}
          <BigButton
            label={navigation.active ? 'Чиглүүлэг зогсоох' : 'Хаашаа явах вэ? Дарж байгаад хэл'}
            onPress={navigation.active ? navigation.stop : undefined}
            onPressIn={navigation.active ? undefined : () => (suspendWalking(true), void navigation.startListening())}
            onPressOut={
              navigation.active
                ? undefined
                : () => void navigation.finishListening().finally(() => suspendWalking(false))
            }
            disabled={busy !== null}
            active={navigation.active}
          />
          {navigation.pending && <BigButton label="Чиглүүлж эхлэх" onPress={navigation.start} />}
          {navigation.message !== '' && <Text style={styles.message}>{navigation.message}</Text>}

          <Text accessibilityLiveRegion="polite" style={styles.message}>
            {walking.active ? walkText : message}
          </Text>
        </ScrollView>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 20, gap: 16 },
  title: { color: colors.text, fontSize: 30, fontWeight: '800', textAlign: 'center' },
  status: { color: colors.accent, fontSize: 18, textAlign: 'center', paddingVertical: 8 },
  warning: { color: colors.warning },
  button: { backgroundColor: colors.primary, borderRadius: 20, paddingVertical: 28, alignItems: 'center' },
  active: { backgroundColor: colors.accent },
  dim: { opacity: 0.6 },
  buttonText: { color: colors.background, fontSize: 26, fontWeight: '800' },
  message: { color: colors.text, fontSize: 22, lineHeight: 32 },
});
