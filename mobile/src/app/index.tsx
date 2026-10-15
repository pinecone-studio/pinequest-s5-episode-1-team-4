import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CameraPreview } from '../components/CameraPreview';
import { useNavigation } from '../hooks/useNavigation';
import { useWalkingMode } from '../hooks/useWalkingMode';
import { analyzeScene, deletePhoto, readText, type SceneAnalysis } from '../lib/api';
import { cameraFrames, captureJpeg, isCameraReachable } from '../lib/camera';
import { latestDistanceCm } from '../lib/cameraStream';
import { SENSOR_MAX_AGE_MS, STOP_CM, NEAR_CM } from '../lib/obstacle';
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
// Хараагүй хүн арай удаан товшдог — 0.4 сек байхад 3 товшилт тус бүр 1 гэж тоологдож байсан.
const TAP_GAP_MS = 600;
const TAP_TASKS: Record<number, Task> = { 2: 'read', 3: 'scene' };
// Тод кадр авахын өмнө урьдчилан харах урсгал хаагдахыг хүлээнэ — эс бөгөөс кадрын хэмжээ солигдож будлина.
const STREAM_CLOSE_MS = 300;

const CAMERA_STATUS = {
  checking: 'Камерыг шалгаж байна…',
  ok: 'Камер холбогдсон',
  missing: 'Камер олдсонгүй. Дарж дахин шалгана.',
};

const CAMERA_DOT = { checking: colors.warning, ok: colors.ok, missing: colors.danger };
// Мэдрэгчийн зайг дэлгэцэнд шинэчлэх давтамж — алхах горимын 100 мс-ийн шалгалтаас тусдаа.
const DISTANCE_REFRESH_MS = 300;

/** Малгайн мэдрэгчийн сүүлийн зай — алхах горим унтраалттай бол null. */
function useDistance(active: boolean) {
  const [cm, setCm] = useState<number | null>(null);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setCm(latestDistanceCm(SENSOR_MAX_AGE_MS)), DISTANCE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [active]);
  return active ? cm : null;
}

function DistancePill({ cm }: { cm: number | null }) {
  if (cm === null) return null;
  const far = !Number.isFinite(cm);
  const color = far ? colors.accent : cm < STOP_CM ? colors.danger : cm < NEAR_CM ? colors.primary : colors.accent;
  return (
    <View style={[styles.pill, { borderColor: color }]}>
      <Text style={[styles.pillText, { color }]}>{far ? 'Урд чөлөөтэй' : `Урд ${(cm / 100).toFixed(1)} м`}</Text>
    </View>
  );
}

/** Микрофоны дүрс — нэмэлт icon сан шаардахгүй. */
function Mic({ color }: { color: string }) {
  return (
    <View style={styles.micWrap}>
      <View style={[styles.micHead, { borderColor: color }]} />
      <View style={[styles.micHolder, { borderColor: color }]} />
      <View style={[styles.micStem, { backgroundColor: color }]} />
      <View style={[styles.micBase, { backgroundColor: color }]} />
    </View>
  );
}

type TileProps = { label: string; hint: string; onPress(): void; disabled: boolean; active: boolean; primary?: boolean };

/** Том хавтан товч — хараатай туслагч, сул хараатай хүнд; хараагүй хүн товшилтоор ажиллуулна. */
function Tile({ label, hint, onPress, disabled, active, primary = false }: TileProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={hint}
      accessibilityState={{ disabled, selected: active }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, primary && styles.tilePrimary, active && styles.tileActive, (pressed || disabled) && styles.dim]}
    >
      <Text style={[styles.tileLabel, (primary || active) && styles.onLight]} numberOfLines={1} adjustsFontSizeToFit>
        {label}
      </Text>
      <Text style={[styles.tileHint, (primary || active) && styles.onLightMuted]}>{hint}</Text>
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
  const navigation = useNavigation(walking.announce, (command) => {
    if (command === 'walk_on') return walking.start();
    if (command === 'walk_off') return walking.stop();
    return runTask(command);
  });

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
  const caption = walking.active ? walkText : message || 'Хоёр товшвол уншина, гурав товшвол орчноо тайлбарлана.';
  const distance = useDistance(walking.active);
  const [holding, setHolding] = useState(false);
  const talkLabel = navigation.active ? 'Чиглүүлэг зогсоох' : holding ? 'Сонсож байна…' : 'Дарж байгаад хэл';

  return (
    <SafeAreaView style={styles.screen}>
      <Pressable style={styles.screen} onPress={onScreenTap} accessible={false}>
        <StatusBar style="light" />
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <Text accessibilityRole="header" style={styles.title}>
              VisionMate
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={CAMERA_STATUS[camera]}
              disabled={camera === 'checking'}
              onPress={checkCamera}
              style={styles.chip}
            >
              <View style={[styles.dot, { backgroundColor: CAMERA_DOT[camera] }]} />
              <Text style={styles.chipText}>{camera === 'ok' ? 'Камер' : camera === 'checking' ? 'Шалгаж байна' : 'Камер алга'}</Text>
            </Pressable>
          </View>

          <View style={styles.live}>
            {/* Тод кадр авахад урсгал саад болохгүйн тулд шинжилгээний үед зогсоно. Урсгал ажиллахгүй бол
              алхах горимд таних кадрыг харуулна — ESP32 нэг удаад нэг хүсэлт үйлчилдэг. */}
            <CameraPreview paused={busy !== null} walking={walking.active} frameUri={walking.frameUri} />
            <View style={styles.overlayTop} pointerEvents="none">
              <View style={[styles.pill, { borderColor: walking.active ? colors.ok : colors.line }]}>
                <Text style={[styles.pillText, { color: walking.active ? colors.ok : colors.muted }]}>
                  {walking.active ? '● АЛХАХ ГОРИМ' : 'ЗОГССОН'}
                </Text>
              </View>
              <DistancePill cm={distance} />
            </View>
            <View style={styles.caption}>
              <Text accessibilityLiveRegion="polite" style={styles.captionText} numberOfLines={3}>
                {caption}
              </Text>
            </View>
          </View>

          <View style={styles.row}>
            <Tile label="Унш" hint="2 товш" primary onPress={() => void runTask('read')} disabled={busy !== null} active={busy === 'read'} />
            <Tile label="Тайлбарла" hint="3 товш" onPress={() => void runTask('scene')} disabled={busy !== null} active={busy === 'scene'} />
          </View>

          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: walking.active, disabled: busy !== null }}
            accessibilityLabel="Алхах горим"
            disabled={busy !== null}
            onPress={() => void (walking.active ? walking.stop() : walking.start())}
            style={({ pressed }) => [styles.toggle, pressed && styles.dim]}
          >
            <Text style={styles.toggleText}>Алхах горим</Text>
            <View style={[styles.track, walking.active && styles.trackOn]}>
              <View style={[styles.knob, walking.active && styles.knobOn]} />
            </View>
          </Pressable>

          {navigation.pending && (
            <Tile label="Чиглүүлж эхлэх" hint="эсвэл 2 товш" primary onPress={navigation.start} disabled={false} active={false} />
          )}
          {navigation.message !== '' && <Text style={styles.navMessage}>{navigation.message}</Text>}

          {/* Сэрэмжлүүлэг ярихгүйн тулд хэлж байх хооронд алхах горим түр зогсоно. */}
          <View style={styles.talkWrap}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={talkLabel}
              accessibilityHint="Дарж байгаад хэл: унш, тайлбарла, алх, эсвэл газрын нэр … руу яв"
              disabled={busy !== null}
              onPress={navigation.active ? navigation.stop : undefined}
              onPressIn={navigation.active ? undefined : () => (setHolding(true), suspendWalking(true), void navigation.startListening())}
              onPressOut={
                navigation.active
                  ? undefined
                  : () => (setHolding(false), void navigation.finishListening().finally(() => suspendWalking(false)))
              }
              style={({ pressed }) => [styles.talk, (holding || navigation.active) && styles.talkActive, pressed && styles.talkPressed, busy !== null && styles.dim]}
            >
              <Mic color={holding || navigation.active ? colors.background : colors.accent} />
            </Pressable>
            <Text style={styles.talkLabel}>{talkLabel}</Text>
            <Text style={styles.talkHint}>унш · тайлбарла · алх · …руу яв</Text>
          </View>
        </ScrollView>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 20, gap: 14, paddingBottom: 24 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: colors.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  dot: { width: 10, height: 10, borderRadius: 5 },
  chipText: { color: colors.text, fontSize: 16, fontWeight: '600' },
  live: { borderRadius: 24, overflow: 'hidden', borderWidth: 1, borderColor: colors.line },
  overlayTop: { position: 'absolute', top: 12, left: 12, right: 12, flexDirection: 'row', justifyContent: 'space-between' },
  pill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1.5, backgroundColor: colors.scrim },
  pillText: { fontSize: 14, fontWeight: '800', letterSpacing: 0.5 },
  caption: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, backgroundColor: colors.scrim },
  captionText: { color: colors.text, fontSize: 20, lineHeight: 28, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 12 },
  tile: { flex: 1, minHeight: 104, borderRadius: 24, padding: 18, justifyContent: 'space-between', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  tilePrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  tileActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  tileLabel: { color: colors.text, fontSize: 28, fontWeight: '800' },
  tileHint: { color: colors.muted, fontSize: 16, fontWeight: '600' },
  onLight: { color: colors.background },
  onLightMuted: { color: colors.background, opacity: 0.7 },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 68, paddingHorizontal: 20, borderRadius: 24, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  toggleText: { color: colors.text, fontSize: 22, fontWeight: '700' },
  track: { width: 64, height: 36, borderRadius: 18, padding: 4, backgroundColor: colors.line },
  trackOn: { backgroundColor: colors.ok },
  knob: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.text },
  knobOn: { transform: [{ translateX: 28 }] },
  navMessage: { color: colors.primary, fontSize: 20, lineHeight: 28, fontWeight: '600', textAlign: 'center' },
  talkWrap: { alignItems: 'center', gap: 6, marginTop: 4 },
  talk: { width: 116, height: 116, borderRadius: 58, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 3, borderColor: colors.accent },
  talkActive: { backgroundColor: colors.accent },
  talkPressed: { transform: [{ scale: 0.96 }] },
  micWrap: { alignItems: 'center' },
  micHead: { width: 26, height: 40, borderRadius: 13, borderWidth: 4 },
  micHolder: { width: 42, height: 24, marginTop: -16, borderWidth: 4, borderTopWidth: 0, borderBottomLeftRadius: 21, borderBottomRightRadius: 21 },
  micStem: { width: 4, height: 8 },
  micBase: { width: 22, height: 4, borderRadius: 2 },
  talkLabel: { color: colors.text, fontSize: 22, fontWeight: '800' },
  talkHint: { color: colors.muted, fontSize: 16 },
  dim: { opacity: 0.6 },
});
