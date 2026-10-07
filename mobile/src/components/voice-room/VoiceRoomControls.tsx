// Voice room controls: status icon, control and action buttons, toggles,
// quality choice, per-person volume stepper and the more-menu item.

import { colors } from "@/src/theme";
import { View, Pressable, Text, Switch, StyleSheet } from "react-native";
import { styles } from "./voiceRoom.styles";
import { Ionicons } from "@expo/vector-icons";
import type { ScreenShareQuality } from "@/src/providers/VoiceSettingsProvider";

export function StatusIcon({
  name,
  tone,
}: {
  name: string;
  tone: "cyan" | "green" | "red";
}) {
  const color =
    tone === "red"
      ? colors.red
      : tone === "green"
        ? colors.green
        : colors.cyan;

  return (
    <View
      style={[
        styles.statusIndicator,
        tone === "red" && styles.statusIndicatorRed,
        tone === "green" && styles.statusIndicatorGreen,
      ]}
    >
      <Ionicons name={name as any} size={15} color={color} />
    </View>
  );
}

export function VoiceControl({
  icon,
  label,
  active = false,
  danger = false,
  disabled = false,
  onPress,
}: {
  icon: string;
  label: string;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.control,
        active && styles.controlActive,
        danger && styles.controlDanger,
        disabled && styles.controlDisabled,
        pressed && !disabled && styles.controlPressed,
      ]}
      disabled={disabled}
      onPress={onPress}
    >
      <Ionicons
        name={icon as any}
        size={19}
        color={
          danger
            ? colors.red
            : active
              ? colors.cyan
              : colors.text
        }
      />
    </Pressable>
  );
}

export function InlineToggle({
  title,
  value,
  onValueChange,
}: {
  title: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.inlineToggle}>
      <Text style={styles.inlineToggleText}>{title}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: "#273149", true: colors.violet }}
        thumbColor="#EEF4FF"
      />
    </View>
  );
}

export function QualityButton({
  label,
  value,
  selected,
  onSelect,
}: {
  label: string;
  value: ScreenShareQuality;
  selected: ScreenShareQuality;
  onSelect: (value: ScreenShareQuality) => void;
}) {
  const active = selected === value;

  return (
    <Pressable accessibilityRole="button"
      style={[
        styles.qualityButton,
        active && styles.qualityButtonActive,
      ]}
      onPress={() => onSelect(value)}
    >
      <Text
        style={[
          styles.qualityButtonText,
          active && styles.qualityButtonTextActive,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function ActionButton({
  icon,
  label,
  detail,
  danger = false,
  onPress,
}: {
  icon: string;
  label: string;
  detail: string;
  danger?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button"
      style={[
        styles.actionButton,
        danger && styles.actionButtonDanger,
      ]}
      onPress={onPress}
    >
      <View
        style={[
          styles.actionIcon,
          danger && styles.actionIconDanger,
        ]}
      >
        <Ionicons
          name={icon as any}
          size={18}
          color={danger ? colors.red : colors.cyan}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={[
            styles.actionLabel,
            danger && styles.actionDangerText,
          ]}
        >
          {label}
        </Text>
        <Text style={styles.actionDetail}>{detail}</Text>
      </View>
      <Ionicons
        name="chevron-forward"
        size={16}
        color={colors.faint}
      />
    </Pressable>
  );
}

export const VOLUME_STEPS = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/** Per-user volume on this device: tap the bar or step with − / +. */
export function VolumeStepper({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const index = VOLUME_STEPS.reduce((best, step, i) => (Math.abs(step - value) < Math.abs(VOLUME_STEPS[best] - value) ? i : best), 0);
  const step = (delta: number) => onChange(VOLUME_STEPS[Math.max(0, Math.min(VOLUME_STEPS.length - 1, index + delta))]);
  return (
    <View style={volumeStyles.wrap}>
      <View style={volumeStyles.head}>
        <Ionicons name="volume-medium-outline" size={18} color={colors.cyan} />
        <Text style={volumeStyles.label}>User volume</Text>
        <Text style={volumeStyles.value}>{Math.round(value * 100)}%</Text>
      </View>
      <View style={volumeStyles.row}>
        <Pressable accessibilityRole="button" accessibilityLabel="Lower volume" disabled={index === 0} onPress={() => step(-1)} style={[volumeStyles.button, index === 0 && { opacity: 0.4 }]}>
          <Ionicons name="remove" size={18} color={colors.text} />
        </Pressable>
        <View style={volumeStyles.track} accessibilityRole="adjustable" accessibilityValue={{ min: 0, max: 200, now: Math.round(value * 100) }}>
          {VOLUME_STEPS.map((stepValue, i) => (
            <Pressable accessibilityRole="button" key={stepValue} accessibilityLabel={`${Math.round(stepValue * 100)}%`} onPress={() => onChange(stepValue)} style={volumeStyles.segmentHit}>
              <View style={[volumeStyles.segment, i <= index && volumeStyles.segmentOn, i === 4 && volumeStyles.segmentNormal]} />
            </Pressable>
          ))}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Raise volume" disabled={index === VOLUME_STEPS.length - 1} onPress={() => step(1)} style={[volumeStyles.button, index === VOLUME_STEPS.length - 1 && { opacity: 0.4 }]}>
          <Ionicons name="add" size={18} color={colors.text} />
        </Pressable>
      </View>
    </View>
  );
}

export const volumeStyles = StyleSheet.create({
  wrap: { marginTop: 8, padding: 12, borderRadius: 14, backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border },
  head: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  label: { flex: 1, color: colors.text, fontSize: 14, fontWeight: "800" },
  value: { color: colors.cyan, fontSize: 13, fontWeight: "900" },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  button: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.wash },
  track: { flex: 1, flexDirection: "row", alignItems: "center" },
  segmentHit: { flex: 1, height: 40, justifyContent: "center", paddingHorizontal: 1.5 },
  segment: { height: 10, borderRadius: 3, backgroundColor: colors.border },
  segmentOn: { backgroundColor: colors.cyan },
  segmentNormal: { height: 16 },
});

export function MoreItem({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: 46, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: pressed ? colors.panel2 : "transparent" })}
    >
      <Ionicons name={icon as any} size={19} color={colors.cyan} />
      <Text style={{ color: colors.text, fontSize: 14, fontWeight: "800" }}>{label}</Text>
    </Pressable>
  );
}
