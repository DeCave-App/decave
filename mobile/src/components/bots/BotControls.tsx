// Small controls the bot builder's forms are made of: a select (a button that
// opens a list sheet), chips, number and text inputs, and an inline error.

import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "@/src/theme";

export type SelectOption = { value: string; label: string; detail?: string };

export function Select({
  value,
  options,
  onChange,
  label,
  placeholder,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  /** Read by screen readers and shown as the sheet's title. */
  label: string;
  placeholder?: string;
}) {
  const { t } = useTranslation(["common"]);
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value);
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${current?.label ?? placeholder ?? ""}`} style={styles.select} onPress={() => setOpen(true)}>
        <Text style={[styles.selectText, !current && styles.placeholder]} numberOfLines={1}>
          {current?.label ?? placeholder ?? ""}
        </Text>
        <Ionicons name="chevron-down" size={16} color={colors.muted} />
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]} onPress={() => {}}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle} numberOfLines={1}>{label}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={t("common.actions.close")} hitSlop={8} onPress={() => setOpen(false)}>
                <Ionicons name="close" size={20} color={colors.text} />
              </Pressable>
            </View>
            <FlatList
              data={options}
              keyExtractor={(option) => option.value}
              style={{ maxHeight: 460 }}
              renderItem={({ item }) => {
                const selected = item.value === value;
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    style={({ pressed }) => [styles.option, pressed && { backgroundColor: colors.panel2 }]}
                    onPress={() => {
                      setOpen(false);
                      if (!selected) onChange(item.value);
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.optionText, selected && { color: colors.cyan }]}>{item.label}</Text>
                      {!!item.detail && <Text style={styles.optionDetail} numberOfLines={2}>{item.detail}</Text>}
                    </View>
                    {selected && <Ionicons name="checkmark" size={18} color={colors.cyan} />}
                  </Pressable>
                );
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

export function Chip({ label, on, onPress, disabled }: { label: string; on: boolean; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on, disabled }}
      disabled={disabled}
      style={[styles.chip, on && styles.chipOn, disabled && { opacity: 0.5 }]}
      onPress={onPress}
    >
      <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

export function ChipRow({ children }: { children: ReactNode }) {
  return <View style={styles.chips}>{children}</View>;
}

export function Input(props: TextInputProps) {
  return <TextInput placeholderTextColor={colors.faint} {...props} style={[styles.input, props.multiline && styles.multiline, props.style]} />;
}

/** A whole-number input; empty means `undefined` when the field is optional. */
export function NumberInput({ value, onChange, optional, placeholder, accessibilityLabel }: { value: number | undefined; onChange: (value: number | undefined) => void; optional?: boolean; placeholder?: string; accessibilityLabel?: string }) {
  return (
    <Input
      value={value === undefined || Number.isNaN(value) ? "" : String(value)}
      keyboardType="numbers-and-punctuation"
      placeholder={placeholder}
      accessibilityLabel={accessibilityLabel}
      onChangeText={(text) => {
        const clean = text.replace(/[^0-9.-]/g, "");
        if (clean === "" || clean === "-") onChange(optional ? undefined : 0);
        else if (Number.isFinite(Number(clean))) onChange(Number(clean));
      }}
      style={styles.number}
    />
  );
}

export function FieldShell({ label, optional, hint, error, children }: { label: string; optional?: boolean; hint?: string; error?: string; children: ReactNode }) {
  const { t } = useTranslation(["bots"]);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {label}
        {optional ? <Text style={styles.optional}> · {t("bots.field.optional")}</Text> : null}
      </Text>
      {children}
      {error ? <Text style={styles.error}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function SmallButton({ label, icon, onPress, disabled, danger }: { label: string; icon?: keyof typeof Ionicons.glyphMap; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} style={[styles.small, disabled && { opacity: 0.4 }]} onPress={onPress}>
      {icon ? <Ionicons name={icon} size={16} color={danger ? colors.red : colors.cyan} /> : <Text style={[styles.smallText, danger && { color: colors.red }]}>{label}</Text>}
    </Pressable>
  );
}

export const botStyles = StyleSheet.create({
  card: { padding: 12, gap: 10, borderRadius: 14, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  sectionTitle: { color: colors.text, fontSize: 15, fontWeight: "900" },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  link: { color: colors.cyan, fontSize: 14, fontWeight: "800" },
});

const styles = StyleSheet.create({
  select: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, borderRadius: 12, backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border },
  selectText: { flex: 1, color: colors.text, fontSize: 14, fontWeight: "700" },
  placeholder: { color: colors.faint },
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(2,5,12,.72)" },
  sheet: { paddingTop: 12, borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: colors.sheet, borderWidth: 1, borderColor: colors.border },
  sheetHead: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingBottom: 8 },
  sheetTitle: { flex: 1, color: colors.text, fontSize: 16, fontWeight: "900" },
  option: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
  optionText: { color: colors.text, fontSize: 15, fontWeight: "700" },
  optionDetail: { color: colors.muted, fontSize: 12, marginTop: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { maxWidth: 220, paddingHorizontal: 11, height: 32, justifyContent: "center", borderRadius: 99, backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border },
  chipOn: { borderColor: colors.cyan, backgroundColor: colors.cyanSoft },
  chipText: { color: colors.muted, fontSize: 13, fontWeight: "800" },
  chipTextOn: { color: colors.cyan },
  input: { minHeight: 42, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, color: colors.text, backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border, fontSize: 14 },
  multiline: { minHeight: 76, textAlignVertical: "top" },
  number: { width: 96 },
  field: { gap: 6 },
  label: { color: colors.muted, fontSize: 12, fontWeight: "900" },
  optional: { color: colors.faint, fontWeight: "700" },
  hint: { color: colors.faint, fontSize: 12, lineHeight: 16 },
  error: { color: colors.red, fontSize: 12, fontWeight: "700" },
  small: { minWidth: 34, height: 32, paddingHorizontal: 8, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border },
  smallText: { color: colors.cyan, fontSize: 12, fontWeight: "800" },
});
