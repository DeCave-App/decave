import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { TurnstileModal } from "@/src/components/TurnstileModal";
import { useSession } from "@/src/providers/SessionProvider";
import { colors } from "@/src/theme";

export default function RegisterScreen() {
  const { register } = useSession();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [turnstileOpen, setTurnstileOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [ok, setOk] = useState(false);

  const working = busy || turnstileOpen;

  const begin = () => {
    setOk(false);
    if (!email.trim() || !username.trim() || !password || !confirm || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
      setNotice("Fill in every field.");
      return;
    }
    if (password !== confirm) {
      setNotice("The passwords do not match.");
      return;
    }
    if (!acceptedTerms) {
      setNotice("Confirm that you are 18 or older and agree to the Terms of Service and Privacy Policy.");
      return;
    }
    setNotice("");
    setTurnstileOpen(true);
  };

  const submitWithToken = async (turnstileToken: string) => {
    setTurnstileOpen(false);
    setBusy(true);
    const result = await register(
      email.trim(),
      username.trim(),
      password,
      birthDate,
      turnstileToken,
    );
    setBusy(false);
    setOk(result.ok);
    setNotice(result.message);
  };

  return (
    <View style={styles.root}>
      <ScrollView keyboardDismissMode="on-drag" contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.box}>
          <View style={styles.brand}>
            <Image source={require("../../assets/decave-mark.png")} style={styles.mark} />
            <Text style={styles.brandText}>DeCave</Text>
          </View>

          <Text maxFontSizeMultiplier={1.3} style={styles.kicker}>JOIN THE CAVE</Text>
          <Text style={styles.title}>Create account</Text>
          <Text style={styles.subtitle}>
            Your account works across DeCave web, desktop and mobile.
          </Text>

          {!!notice && (
            <Text style={ok ? styles.message : styles.error}>{notice}</Text>
          )}

          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            placeholderTextColor={colors.faint}
            keyboardType="email-address"
            autoCapitalize="none"
            style={styles.input}
          />
          <TextInput
            value={username}
            onChangeText={setUsername}
            placeholder="Username"
            placeholderTextColor={colors.faint}
            autoCapitalize="none"
            style={styles.input}
          />
          <TextInput
            value={birthDate}
            onChangeText={(value) => setBirthDate(value.replace(/[^0-9-]/g, "").slice(0, 10))}
            placeholder="Birth date (YYYY-MM-DD)"
            placeholderTextColor={colors.faint}
            keyboardType="numbers-and-punctuation"
            autoCapitalize="none"
            style={styles.input}
          />
          <Text style={styles.ageHint}>Used only to confirm that DeCave is only for adults aged 18 or older. We do not store the exact date.</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor={colors.faint}
            secureTextEntry
            style={styles.input}
          />
          <TextInput
            value={confirm}
            onChangeText={setConfirm}
            placeholder="Confirm password"
            placeholderTextColor={colors.faint}
            secureTextEntry
            style={styles.input}
          />

          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: acceptedTerms }}
            style={styles.consent}
            onPress={() => setAcceptedTerms((value) => !value)}
          >
            <View style={[styles.checkbox, acceptedTerms && styles.checkboxOn]}>
              {acceptedTerms && <Text style={styles.checkmark}>✓</Text>}
            </View>
            <Text style={styles.consentText}>
              I am 18 or older and agree to the{" "}
              <Text style={styles.link} onPress={() => void Linking.openURL("https://de-cave.com/terms")}>
                Terms of Service
              </Text>{" "}
              and{" "}
              <Text style={styles.link} onPress={() => void Linking.openURL("https://de-cave.com/privacy")}>
                Privacy Policy
              </Text>
              .
            </Text>
          </Pressable>

          <Pressable accessibilityRole="button"
            style={({ pressed }) => [
              styles.button,
              pressed && styles.buttonPressed,
              working && styles.buttonWorking,
            ]}
            onPress={begin}
            disabled={working}
          >
            {working && <ActivityIndicator color="#fff" style={styles.buttonSpinner} />}
            <Text style={styles.buttonText}>
              {busy ? "Creating…" : turnstileOpen ? "Verifying…" : "Create account"}
            </Text>
          </Pressable>

          <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => router.replace("/login")}>
            <Text style={styles.secondaryText}>Back to sign in</Text>
          </Pressable>
        </View>
      </ScrollView>

      <TurnstileModal
        visible={turnstileOpen}
        action="register"
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
  consent: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginTop: 4, marginBottom: 8 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  checkboxOn: { backgroundColor: colors.violet, borderColor: colors.violet },
  checkmark: { color: "#fff", fontSize: 13, fontWeight: "900" },
  consentText: { flex: 1, color: colors.muted, fontSize: 13, lineHeight: 19 },
  link: { color: colors.cyan, fontWeight: "700" },
  ageHint: { color: colors.faint, fontSize: 12, lineHeight: 15, marginTop: -3, marginBottom: 7 },
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
  box: {
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
  },});
