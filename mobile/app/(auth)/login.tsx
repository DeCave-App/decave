import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { TurnstileModal } from "@/src/components/TurnstileModal";
import { useSession } from "@/src/providers/SessionProvider";
import { colors } from "@/src/theme";

export default function LoginScreen() {
  const { login, user, pendingMfa, sessionNotice } = useSession();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [staySignedIn, setStaySignedIn] = useState(true);
  const [turnstileOpen, setTurnstileOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (pendingMfa) {
      router.replace("/mfa");
      return;
    }

    if (user) {
      router.replace("/home");
    }
  }, [pendingMfa, user]);

  const submitWithToken = async (turnstileToken: string) => {
    setTurnstileOpen(false);
    setBusy(true);
    setError("");
    const result = await login(
      identifier.trim(),
      password,
      staySignedIn,
      turnstileToken,
    );
    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    if (result.mfaRequired) {
      router.replace("/mfa");
    } else {
      router.replace("/home");
    }
  };

  const working = busy || turnstileOpen;

  const beginLogin = () => {
    if (!/^\S+@\S+\.\S+$/.test(identifier.trim()) || !password) {
      setError("Enter your email and password.");
      return;
    }
    setError("");
    setTurnstileOpen(true);
  };

  return (
    <View style={styles.root}>
      <ScrollView keyboardDismissMode="on-drag" contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.box}>
          <View style={styles.brand}>
            <Image source={require("../../assets/decave-mark.png")} style={styles.mark} />
            <Text style={styles.brandText}>DeCave</Text>
          </View>

          <Text maxFontSizeMultiplier={1.3} style={styles.kicker}>VOICE · HUBS · ROOMS</Text>
          <Text style={styles.title}>Welcome</Text>
          <Text style={styles.subtitle}>
            Sign in to your existing DeCave account.
          </Text>

          {!!sessionNotice && <Text style={styles.message}>{sessionNotice}</Text>}
          {!!error && <Text style={styles.error}>{error}</Text>}

          <TextInput
            value={identifier}
            onChangeText={setIdentifier}
            placeholder="Email"
            placeholderTextColor={colors.faint}
            keyboardType="email-address"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor={colors.faint}
            secureTextEntry
            autoCapitalize="none"
            style={styles.input}
          />

          <View style={styles.row}>
            <Text style={styles.check}>Stay signed in</Text>
            <Switch
              value={staySignedIn}
              onValueChange={setStaySignedIn}
              trackColor={{ false: "#26314A", true: colors.violet }}
            />
          </View>

          <Pressable accessibilityRole="button"
            style={({ pressed }) => [
              styles.button,
              pressed && styles.buttonPressed,
              working && styles.buttonWorking,
            ]}
            onPress={beginLogin}
            disabled={working}
          >
            {working && <ActivityIndicator color="#fff" style={styles.buttonSpinner} />}
            <Text style={styles.buttonText}>
              {busy ? "Signing in…" : turnstileOpen ? "Verifying…" : "Sign in"}
            </Text>
          </Pressable>

          <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => router.push("/forgot")}>
            <Text style={styles.secondaryText}>Forgot password?</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => router.push("/register")}>
            <Text style={styles.secondaryText}>Create a DeCave account</Text>
          </Pressable>
        </View>
      </ScrollView>

      <TurnstileModal
        visible={turnstileOpen}
        action="login"
        onCancel={() => setTurnstileOpen(false)}
        onToken={(token) => void submitWithToken(token)}
      />
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
    justifyContent: "center",
    flexDirection: "row",
    marginTop: 6,
  },
  buttonPressed: { opacity: 0.8, transform: [{ scale: 0.97 }] },
  buttonWorking: { opacity: 0.75 },
  buttonSpinner: { marginRight: 8 },
  buttonText: { color: "#fff", fontWeight: "900", fontSize: 15 },
  secondary: { paddingVertical: 11, alignItems: "center" },
  secondaryText: { color: colors.cyan, fontWeight: "700" },
  error: { color: colors.red, marginVertical: 8, lineHeight: 19 },
  message: { color: colors.green, marginVertical: 8, lineHeight: 19 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginVertical: 4 },
  check: { color: colors.muted, fontSize: 13 },
  box: {
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
  },
});
