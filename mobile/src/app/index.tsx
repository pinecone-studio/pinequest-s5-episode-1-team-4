import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '../theme';

export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <Text accessibilityRole="header" style={styles.title}>
        VisionMate
      </Text>
      <Text style={styles.body}>Орчноо сонсож ойлго</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  title: { color: colors.text, fontSize: 30, fontWeight: '800' },
  body: { color: colors.muted, fontSize: 18 },
});
