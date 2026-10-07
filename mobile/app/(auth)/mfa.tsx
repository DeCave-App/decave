import { useEffect, useState } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { useSession } from "@/src/providers/SessionProvider";
import { colors } from "@/src/theme";

export default function MfaScreen() {
  const { pendingMfa, pendingMfaKind, completeMfa } = useSession();
  const isUser = pendingMfaKind === "user";
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pendingMfa) {
      router.replace("/login");
    }
  }, [pendingMfa]);

  if (!pendingMfa) return null;

  const submit = async () => {
    if (!code.trim()) return;
    setBusy(true);
    setError("");
    const result = await completeMfa(code.trim());
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.replace("/home");
  };

  return (
    <View style={styles.root}>
      <ScrollView keyboardDismissMode="on-drag" contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.box}>
          <View style={styles.brand}>
            <Image source={require("../../assets/decave-mark.png")} style={styles.mark} />
            <Text style={styles.brandText}>DeCave</Text>
          </View>

          <Text maxFontSizeMultiplier={1.3} style={styles.kicker}>{isUser ? "TWO-FACTOR" : "PLATFORM OWNER"}</Text>
          <Text style={styles.title}>{isUser ? "Two-factor check" : "Verify owner access"}</Text>
          <Text style={styles.subtitle}>
            {isUser
              ? "Enter the 6-digit code from your authenticator app, or one of your recovery codes."
              : "Enter your 6-digit authenticator code or a one-time recovery code."}
          </Text>

          {!!error && <Text style={styles.error}>{error}</Text>}

          <TextInput
            value={code}
            onChangeText={(value) => setCode(value.toUpperCase().replace(/\s/g, "").slice(0, 19))}
            placeholder="Authenticator or recovery code"
            placeholderTextColor={colors.faint}
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            returnKeyType="done"
            onSubmitEditing={() => void submit()}
            style={styles.input}
          />

          <Pressable accessibilityRole="button" style={styles.button} onPress={() => void submit()} disabled={busy}>
            <Text style={styles.buttonText}>{busy ? "Checking…" : isUser ? "Continue" : "Verify & enter"}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1, justifyContent: "center", padding: 24 },
  brand: { flexDirection: "row", alignItems: "center", marginBottom: 24 },
  mark: { width: 76, height: 76, resizeMode: "contain" },
  brandText: { color: colors.text, fontSize: 32, fontWeight: "900", marginLeft: 12 },
  kicker: { color: colors.cyan, fontSize: 12, letterSpacing: 2.3, fontWeight: "800" },
  title: { color: colors.text, fontSize: 30, fontWeight: "900", marginTop: 7 },
  subtitle: { color: colors.muted, marginTop: 7, lineHeight: 20, marginBottom: 22 },
  input: {
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    borderRadius: 13,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 10,
    fontSize: 15,
  },
  button: {
    backgroundColor: colors.violet,
    borderRadius: 13,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 6,
  },
  buttonText: { color: "#fff", fontWeight: "900", fontSize: 15 },
  error: { color: colors.red, marginVertical: 8, lineHeight: 19 },
  box: {
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
  },});
