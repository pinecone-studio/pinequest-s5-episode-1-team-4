import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useWalkingMode } from '../hooks/useWalkingMode';
import { analyzeScene, deletePhoto, readText, type SceneAnalysis } from '../lib/api';
import { cameraFrames, captureJpeg, isCameraReachable } from '../lib/camera';
import { speakDescription } from '../lib/speech';
import { colors } from '../theme';

type Task = 'scene' | 'read';

const TASKS: Record<Task, { label: string; busy: string; hiRes: boolean; run(uri: string): Promise<SceneAnalysis> }> = {
  scene: { label: 'Орчноо таних', busy: 'Орчныг шинжилж байна…', hiRes: false, run: analyzeScene },
  // Жижиг бичиг 640px-д уншигдахгүй.
  read: { label: 'Энийг унш', busy: 'Бичгийг уншиж байна…', hiRes: true, run: readText },
};

const CAMERA_STATUS = {
  checking: 'Камерыг шалгаж байна…',
  ok: 'Камер холбогдсон',
  missing: 'Камер олдсонгүй. Дарж дахин шалгана.',
};

type ButtonProps = { label: string; onPress(): void; disabled?: boolean; active?: boolean };

function BigButton({ label, onPress, disabled = false, active = false }: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, selected: active }}
      disabled={disabled}
      onPress={onPress}
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

  const checkCamera = () => {
    setCamera('checking');
    void isCameraReachable().then((ok) => setCamera(ok ? 'ok' : 'missing'));
  };

  useEffect(() => {
    void isCameraReachable().then((ok) => setCamera(ok ? 'ok' : 'missing'));
  }, []);

  async function runTask(task: Task) {
    const { busy: busyText, hiRes, run } = TASKS[task];
    setBusy(task);
    setMessage(busyText);
    let uri: string | undefined;
    try {
      uri = await captureJpeg(hiRes);
      const { description, audioBase64 } = await run(uri);
      setMessage(description);
      void speakDescription(description, audioBase64);
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Алдаа гарлаа.';
      setMessage(text);
      // Хэрэглэгч дэлгэц харахгүй тул алдааг ч дуугаар хэлнэ.
      void speakDescription(text);
    } finally {
      if (uri) deletePhoto(uri);
      setBusy(null);
    }
  }

  const walkText = walking.error || walking.lastDescription || 'Алхах горим ажиллаж байна.';

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text accessibilityRole="header" style={styles.title}>
          VisionMate
        </Text>
        <Pressable accessibilityRole="button" disabled={camera === 'checking'} onPress={checkCamera}>
          <Text style={[styles.status, camera === 'missing' && styles.warning]}>{CAMERA_STATUS[camera]}</Text>
        </Pressable>

        {(Object.keys(TASKS) as Task[]).map((task) => (
          <BigButton
            key={task}
            label={TASKS[task].label}
            onPress={() => void runTask(task)}
            disabled={busy !== null || walking.active}
            active={busy === task}
          />
        ))}
        <BigButton
          label={walking.active ? 'Алхах горимыг зогсоох' : 'Алхах горим'}
          onPress={() => void (walking.active ? walking.stop() : walking.start())}
          disabled={busy !== null}
          active={walking.active}
        />

        <Text accessibilityLiveRegion="polite" style={styles.message}>
          {walking.active ? walkText : message}
        </Text>
      </ScrollView>
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
