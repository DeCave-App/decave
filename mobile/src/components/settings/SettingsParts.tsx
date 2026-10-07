// Building blocks of the settings screen: menu sections and rows, headings,
// cards, the status header, dividers and toggles.

import { View, Text, Pressable, Switch } from "react-native";
import { styles } from "./settingsScreen.styles";
import { colors } from "@/src/theme";
import { Ionicons } from "@expo/vector-icons";

export function MenuSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.menuSection}>
      <Text style={styles.menuSectionTitle}>{title}</Text>
      <View style={styles.menuCard}>{children}</View>
    </View>
  );
}

export function SettingsMenuRow({
  icon,
  tint = colors.text,
  title,
  detail,
  value,
  onPress,
  last = false,
}: {
  icon: string;
  tint?: string;
  title: string;
  detail: string;
  value?: string;
  onPress?: () => void;
  last?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.menuRow, last && styles.menuRowLast, pressed && onPress && styles.menuRowPressed]}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
    >
      <View style={[styles.menuRowIcon, { backgroundColor: `${tint}22` }]}>
        <Ionicons name={icon as any} size={19} color={tint} />
      </View>
      <View style={styles.menuRowCopy}>
        <Text style={styles.menuRowTitle}>{title}</Text>
        <Text style={styles.menuRowDetail}>{detail}</Text>
      </View>
      {!!value && <Text style={styles.menuRowValue}>{value}</Text>}
      {!!onPress && <Ionicons name="chevron-forward" size={18} color={colors.faint} />}
    </Pressable>
  );
}

export function SectionHeading({
  title,
}: {
  icon?: string;
  title: string;
}) {
  return (
    <View style={styles.sectionHeading} accessibilityRole="header" accessibilityLabel={title}>
      <Text maxFontSizeMultiplier={1.3} style={styles.section}>{title}</Text>
      <View style={styles.sectionRule} />
    </View>
  );
}

export function SettingsCard({
  children,
}: {
  children: React.ReactNode;
}) {
  return <View style={styles.card}>{children}</View>;
}

export function StatusHeader({
  icon,
  title,
  detail,
  status,
  live,
}: {
  icon: string;
  title: string;
  detail: string;
  status: string;
  live: boolean;
}) {
  return (
    <View style={styles.statusHeader}>
      <View style={styles.statusIcon}>
        <Ionicons name={icon as any} size={19} color={colors.cyan} />
      </View>

      <View style={{ flex: 1 }}>
        <Text style={styles.label}>{title}</Text>
        <Text style={styles.help}>{detail}</Text>
      </View>

      <View
        style={[
          styles.statusPill,
          live && styles.statusPillLive,
        ]}
      >
        <View
          style={[
            styles.statusPillDot,
            live && styles.statusPillDotLive,
          ]}
        />
        <Text maxFontSizeMultiplier={1.3}
          style={[
            styles.statusPillText,
            live && styles.statusPillTextLive,
          ]}
        >
          {status}
        </Text>
      </View>
    </View>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

export function SettingToggle({
  icon,
  title,
  detail,
  value,
  onValueChange,
}: {
  icon: string;
  title: string;
  detail: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleIcon}>
        <Ionicons
          name={icon as any}
          size={17}
          color={value ? colors.cyan : colors.muted}
        />
      </View>

      <View style={styles.toggleCopy}>
        <Text style={styles.toggleTitle}>{title}</Text>
        <Text style={styles.toggleHelp}>{detail}</Text>
      </View>

      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{
          false: "#263148",
          true: colors.violet,
        }}
        thumbColor="#EEF4FF"
      />
    </View>
  );
}
