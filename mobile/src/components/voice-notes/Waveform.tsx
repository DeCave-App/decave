// Bars for a voice note: live while recording, played portion highlighted
// on playback. Tap or drag on it to seek when `onSeek` is given.

import { useRef } from "react";
import { StyleSheet, View } from "react-native";
import { colors } from "@/src/theme";

export function Waveform({
  levels,
  progress = 0,
  onSeek,
  onSeekEnd,
  activeColor = colors.cyan,
  label,
}: {
  levels: readonly number[];
  progress?: number;
  onSeek?: (ratio: number) => void;
  onSeekEnd?: () => void;
  activeColor?: string;
  label?: string;
}) {
  const width = useRef(1);
  const seek = (x: number) => onSeek?.(Math.min(1, Math.max(0, x / Math.max(1, width.current))));
  return (
    <View
      style={styles.wave}
      onLayout={(e) => {
        width.current = e.nativeEvent.layout.width;
      }}
      accessible={!!onSeek}
      accessibilityRole={onSeek ? "adjustable" : undefined}
      accessibilityLabel={label}
      accessibilityValue={onSeek ? { min: 0, max: 100, now: Math.round(progress * 100) } : undefined}
      accessibilityActions={onSeek ? [{ name: "increment" }, { name: "decrement" }] : undefined}
      onAccessibilityAction={(e) => {
        if (!onSeek) return;
        onSeek(Math.min(1, Math.max(0, progress + (e.nativeEvent.actionName === "increment" ? 0.1 : -0.1))));
        onSeekEnd?.();
      }}
      onStartShouldSetResponder={() => !!onSeek}
      onMoveShouldSetResponder={() => !!onSeek}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => seek(e.nativeEvent.locationX)}
      onResponderMove={(e) => seek(e.nativeEvent.locationX)}
      onResponderRelease={() => onSeekEnd?.()}
      onResponderTerminate={() => onSeekEnd?.()}
    >
      {levels.map((level, i) => (
        <View
          key={i}
          pointerEvents="none"
          style={[
            styles.bar,
            {
              height: `${Math.max(10, Math.round(level * 100))}%`,
              backgroundColor: i / levels.length < progress ? activeColor : colors.faint,
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wave: { flex: 1, height: 30, flexDirection: "row", alignItems: "center", gap: 1.5, minWidth: 60 },
  bar: { flex: 1, borderRadius: 1.5, minWidth: 1.5 },
});
