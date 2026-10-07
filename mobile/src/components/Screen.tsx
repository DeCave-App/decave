import { createContext, useContext, type PropsWithChildren } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { colorMode, colors } from "@/src/theme";
import { useSkin } from "@/src/skin";

/** True inside the Lounge shell, which already pads for the top and bottom insets. */
export const InShellContext = createContext(false);

export function Screen({ children }: PropsWithChildren) {
  const { palette } = useSkin();
  const inShell = useContext(InShellContext);
  return (
    <SafeAreaView
      edges={inShell ? ["left", "right"] : undefined}
      style={[styles.safe, { backgroundColor: inShell ? "transparent" : palette.bg }]}
    >
      <StatusBar style={colorMode === "light" ? "dark" : "light"} />
      <View style={[styles.body, { backgroundColor: inShell ? "transparent" : palette.bg }]}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, backgroundColor: colors.bg },
});
