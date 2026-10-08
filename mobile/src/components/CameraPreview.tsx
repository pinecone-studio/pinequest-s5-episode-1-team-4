import { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { getCameraUrl } from '../lib/camera';

const RETRY_MS = 3_000;

type Props = {
  paused: boolean;
  /** Кадр ирсний дараа дараагийнхыг хүсэх хүртэл хүлээх хугацаа. */
  refreshMs: number;
};

/**
 * Камерын харж буйг харуулна — туслагч хүн камерыг зөв чиглүүлэхэд.
 * Шинэ кадрыг далд ачаалж байж солино, эс бөгөөс зураг анивчина.
 */
export function CameraPreview({ paused, refreshMs }: Props) {
  const [shown, setShown] = useState<string>();
  const [next, setNext] = useState<string>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (paused || next) return;
    const delay = failed ? RETRY_MS : shown ? refreshMs : 0;
    const timer = setTimeout(() => setNext(`${getCameraUrl()}/capture?t=${Date.now()}`), delay);
    return () => clearTimeout(timer);
  }, [paused, next, shown, failed, refreshMs]);

  return (
    // Хараагүй хэрэглэгчийн дэлгэц уншигчид хэрэггүй.
    <View style={styles.frame} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {shown && <Image source={{ uri: shown }} style={styles.image} />}
      {next && (
        <Image
          source={{ uri: next, cache: 'reload' }}
          style={[styles.image, styles.loading]}
          onLoad={() => {
            setShown(next);
            setNext(undefined);
            setFailed(false);
          }}
          onError={() => {
            setNext(undefined);
            setFailed(true);
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { aspectRatio: 4 / 3, borderRadius: 20, overflow: 'hidden', backgroundColor: '#000' },
  image: { ...StyleSheet.absoluteFill, resizeMode: 'cover' },
  loading: { opacity: 0 },
});
