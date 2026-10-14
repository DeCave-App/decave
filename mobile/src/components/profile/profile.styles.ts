// Styles for the profile screen's photo, banner and accent controls.

import { StyleSheet } from "react-native";
import { colors } from "@/src/theme";

export const styles = StyleSheet.create({
  // Matches the profile screen's info rows.
  row: {
    minHeight: 65,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowLast: { borderBottomWidth: 0 },
  rowMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  rowPressed: { opacity: 0.76 },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.cyanSoft,
  },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: { color: colors.text, fontWeight: "800", fontSize: 13 },
  rowHelp: { color: colors.muted, fontSize: 11, marginTop: 3 },
  remove: {
    minHeight: 32,
    paddingHorizontal: 10,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.redSoft,
  },
  removeText: { color: colors.red, fontSize: 12, fontWeight: "800" },

  accentBlock: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 13 },
  accentLabel: { color: colors.muted, fontSize: 11, fontWeight: "800" },
  accentHelp: { color: colors.faint, fontSize: 11, lineHeight: 15, marginTop: 8 },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: 9, marginTop: 10 },
  swatch: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "transparent",
  },
  swatchActive: { borderColor: colors.text },
});
