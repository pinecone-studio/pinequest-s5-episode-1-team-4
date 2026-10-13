import { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { getCameraUrl, openPreviewStream } from '../lib/camera';

const REFRESH_MS = 150;
const RETRY_MS = 3_000;
// Wi-Fi-д гацсан кадрыг хүлээлгүй орхиж шинийг авна — эс бөгөөс дүрс хэдэн секунд хөлддөг.
const STALL_MS = 1_500;

type Props = {
  paused: boolean;
  walking: boolean;
  /** Алхах горимын таних кадр — урсгал ажиллахгүй үед камерт тусдаа хүсэлт явуулахгүй, үүнийг харуулна. */
  frameUri?: string;
};

function toDataUri(jpeg: Uint8Array) {
  let binary = '';
  for (let i = 0; i < jpeg.length; i += 0x8000) binary += String.fromCharCode(...jpeg.subarray(i, i + 0x8000));
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

/**
 * Камерын харж буйг харуулна — туслагч хүн камерыг зөв чиглүүлэхэд. Үндсэндээ MJPEG урсгал;
 * урсгал ажиллахгүй бол кадраар нь асууна. Шинэ кадрыг далд ачаалж байж солино, эс бөгөөс анивчина.
 */
export function CameraPreview({ paused, walking, frameUri }: Props) {
  const [shown, setShown] = useState<string>();
  const [next, setNext] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [streamDown, setStreamDown] = useState(false);
  const [seenFrame, setSeenFrame] = useState(frameUri);

  if (frameUri !== seenFrame) {
    setSeenFrame(frameUri);
    if (frameUri && streamDown) setNext(frameUri);
  }

  useEffect(() => {
    if (paused) return;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let close = () => {};
    const open = () => {
      close = openPreviewStream(
        (jpeg) => {
          setStreamDown(false);
          setNext((current) => current ?? toDataUri(jpeg));
        },
        () => {
          if (stopped) return;
          setStreamDown(true);
          retry = setTimeout(open, RETRY_MS);
        },
      );
    };
    open();
    return () => {
      stopped = true;
      clearTimeout(retry);
      close();
    };
  }, [paused]);

  useEffect(() => {
    if (paused || !streamDown || walking || next) return;
    const delay = failed ? RETRY_MS : shown ? REFRESH_MS : 0;
    const timer = setTimeout(() => setNext(`${getCameraUrl()}/capture?t=${Date.now()}`), delay);
    return () => clearTimeout(timer);
  }, [paused, streamDown, walking, next, shown, failed]);

  useEffect(() => {
    if (!next) return;
    const timer = setTimeout(() => setNext(undefined), STALL_MS);
    return () => clearTimeout(timer);
  }, [next]);

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
