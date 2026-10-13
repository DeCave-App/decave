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
import { MINIMUM_SIGNUP_AGE } from "../../../shared/legal-consent";
import { Trans, useTranslation } from "react-i18next";

export default function RegisterScreen() {
  const { t } = useTranslation(["auth", "common"]);
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
      setNotice(t("auth.mobile.register.fillInEveryField"));
      return;
    }
    const enteredDate = new Date(`${birthDate}T00:00:00Z`);
    const cutoff = new Date(); cutoff.setUTCFullYear(cutoff.getUTCFullYear() - MINIMUM_SIGNUP_AGE);
    if (Number.isNaN(enteredDate.getTime()) || enteredDate.toISOString().slice(0, 10) !== birthDate || enteredDate > cutoff) { setNotice(t("auth.mobile.register.youMustBeAtLeast", { age: MINIMUM_SIGNUP_AGE })); return; }
    if (password.length < 10) { setNotice(t("auth.mobile.register.useAPasswordWithAt")); return; }
    if (password !== confirm) {
      setNotice(t("auth.mobile.register.thePasswordsDoNotMatch"));
      return;
    }
    if (!acceptedTerms) {
      setNotice(t("auth.mobile.register.confirmThatYouAre18"));
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

          <Text maxFontSizeMultiplier={1.3} style={styles.kicker}>{t("auth.mobile.register.joinTheCave")}</Text>
          <Text style={styles.title}>{t("auth.mobile.register.createAccount")}</Text>
          <Text style={styles.subtitle}>
            {t("auth.mobile.register.yourAccountWorksAcrossDecave")}
          </Text>

          {!!notice && (
            <Text style={ok ? styles.message : styles.error}>{notice}</Text>
          )}

          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder={t("common.auth.email")}
            placeholderTextColor={colors.faint}
            keyboardType="email-address"
            autoCapitalize="none"
            style={styles.input}
          />
          <TextInput
            value={username}
            onChangeText={setUsername}
            placeholder={t("common.auth.username")}
            placeholderTextColor={colors.faint}
            autoCapitalize="none"
            style={styles.input}
          />
          <TextInput
            value={birthDate}
            onChangeText={(value) => setBirthDate(value.replace(/[^0-9-]/g, "").slice(0, 10))}
            placeholder={t("auth.mobile.register.birthDateYyyyMmDd")}
            placeholderTextColor={colors.faint}
            keyboardType="numbers-and-punctuation"
            autoCapitalize="none"
            style={styles.input}
          />
          <Text style={styles.ageHint}>{t("auth.mobile.register.usedOnlyToConfirmThat", { age: MINIMUM_SIGNUP_AGE })}</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder={t("common.auth.password")}
            placeholderTextColor={colors.faint}
            secureTextEntry
            style={styles.input}
          />
          <TextInput
            value={confirm}
            onChangeText={setConfirm}
            placeholder={t("common.auth.confirmPassword")}
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
              <Trans
                t={t}
                i18nKey="common.auth.consent"
                values={{ age: MINIMUM_SIGNUP_AGE }}
                components={[
                  <Text key="terms" style={styles.link} onPress={(event) => { event.stopPropagation(); void Linking.openURL("https://de-cave.com/terms"); }} />,
                  <Text key="privacy" style={styles.link} onPress={(event) => { event.stopPropagation(); void Linking.openURL("https://de-cave.com/privacy"); }} />,
                ]}
              />
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
              {busy ? t("auth.mobile.register.creating") : turnstileOpen ? t("common.status.verifying") : t("auth.mobile.register.createAccount")}
            </Text>
          </Pressable>

          <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => router.replace("/login")}>
            <Text style={styles.secondaryText}>{t("auth.mobile.register.backToSignIn")}</Text>
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
  ageHint: { color: colors.faint, fontSize: 12, lineHeight: 15, marginTop: -3, marginBottom: 7 },
  consent: { flexDirection: "row", alignItems: "flex-start", gap: 9, marginTop: 4, marginBottom: 9 },
  checkbox: { width: 18, height: 18, borderWidth: 1, borderColor: colors.muted, borderRadius: 4, alignItems: "center", justifyContent: "center" },
  checkboxOn: { backgroundColor: colors.violet, borderColor: colors.violet },
  checkmark: { color: "#fff", fontSize: 13, fontWeight: "900" },
  consentText: { flex: 1, color: colors.muted, fontSize: 12, lineHeight: 18 },
  link: { color: colors.cyan, textDecorationLine: "underline", fontWeight: "700" },
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
