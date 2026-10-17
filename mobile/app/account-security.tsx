import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Clipboard, Linking, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as FileSystem from "expo-file-system/legacy";
import { Screen } from "@/src/components/Screen";
import { apiErrorText, apiFetch, apiJson, type ApiErrorBody } from "@/src/lib/api";
import { loadAccountPreferences, updateAccountPreferences } from "@/src/lib/account-preferences";
import { useSession } from "@/src/providers/SessionProvider";
import { accountExportStatus } from "@/src/lib/account-export";
import { colors } from "@/src/theme";
import { useTranslation } from "react-i18next";
import { dateLocale } from "@/src/lib/date-locale";
import { useStreamerMode } from "@/src/hooks/useStreamerMode";

export default function AccountSecurityScreen() {
  const { t } = useTranslation(["settings", "common", "chat", "errors"]);
  const { token, user, invalidate, refreshUser } = useSession();
  const streamerMode = useStreamerMode();
  const [email, setEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [emailMfaCode, setEmailMfaCode] = useState("");
  const [emailMfaRequired, setEmailMfaRequired] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [dangerAction, setDangerAction] = useState<"disable" | "delete" | null>(null);
  const [dangerPassword, setDangerPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  // Username (the Worker enforces the format, uniqueness and 30-day cooldown)
  const [newUsername, setNewUsername] = useState("");
  const [usernamePassword, setUsernamePassword] = useState("");
  const [usernameBusy, setUsernameBusy] = useState(false);
  const [usernameNotice, setUsernameNotice] = useState("");
  const [usernameError, setUsernameError] = useState("");
  const [usernameAvailableAt, setUsernameAvailableAt] = useState<string | null>(null);

  // Two-factor sign-in
  const [mfa, setMfa] = useState<MfaStatus | null>(null);
  const [mfaLoading, setMfaLoading] = useState(true);
  const [mfaStep, setMfaStep] = useState<MfaStep>("idle");
  const [mfaPassword, setMfaPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaSetup, setMfaSetup] = useState<{ secret: string; otpauth: string } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaError, setMfaError] = useState("");
  const [mfaNotice, setMfaNotice] = useState("");

  // Sign-in alerts
  const [loginAlerts, setLoginAlerts] = useState<boolean | null>(null);
  const [alertsError, setAlertsError] = useState("");

  // Data export
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  const loadMfa = useCallback(async () => {
    if (!token) return;
    try {
      setMfa(await apiJson<MfaStatus>("/api/account/mfa", {}, token));
    } catch (cause) {
      setMfaError(cause instanceof Error ? cause.message : t("settings.mobile.accountSecurity.couldNotLoadTwoFactor"));
    } finally {
      setMfaLoading(false);
    }
  }, [token]);

  useEffect(() => { void loadMfa(); }, [loadMfa]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    loadAccountPreferences(token)
      .then((prefs) => {
        if (!active) return;
        setLoginAlerts(Boolean(prefs.loginAlerts));
        setUsernameAvailableAt(prefs.usernameChangeAvailableAt ?? null);
      })
      .catch((cause) => { if (active) setAlertsError(cause instanceof Error ? cause.message : t("settings.mobile.accountSecurity.couldNotLoadThisSetting")); });
    return () => { active = false; };
  }, [token]);

  const resetMfaForm = (step: MfaStep = "idle") => {
    setMfaStep(step);
    setMfaPassword("");
    setMfaCode("");
    setMfaError("");
    setMfaNotice("");
    if (step === "idle") setMfaSetup(null);
  };

  const startMfaSetup = async () => {
    if (!token || mfaBusy) return;
    if (!mfaPassword) { setMfaError(t("settings.mobile.accountSecurity.enterYourCurrentPassword")); return; }
    setMfaBusy(true); setMfaError("");
    try {
      const data = await apiJson<{ secret: string; otpauth: string }>("/api/account/mfa/setup", jsonPost({ currentPassword: mfaPassword }), token);
      setMfaSetup(data);
      setMfaPassword("");
      setMfaCode("");
      setMfaStep("setup");
    } catch (cause) { setMfaError(cause instanceof Error ? cause.message : t("settings.mobile.accountSecurity.couldNotStartSetup")); }
    finally { setMfaBusy(false); }
  };

  const enableMfa = async () => {
    if (!token || mfaBusy) return;
    if (!/^\d{6}$/.test(mfaCode)) { setMfaError(t("settings.mobile.accountSecurity.enterThe6DigitCode")); return; }
    setMfaBusy(true); setMfaError("");
    try {
      const data = await apiJson<{ enabled: boolean; recoveryCodes?: string[] }>("/api/account/mfa/enable", jsonPost({ code: mfaCode }), token);
      setMfaSetup(null);
      setMfaCode("");
      setRecoveryCodes(Array.isArray(data.recoveryCodes) ? data.recoveryCodes : []);
      setMfaStep("codes");
      setMfaNotice(t("settings.mobile.accountSecurity.twoFactorSignInIs"));
      void loadMfa();
    } catch (cause) { setMfaError(cause instanceof Error ? cause.message : t("settings.mobile.accountSecurity.thatCodeDidnTWork")); }
    finally { setMfaBusy(false); }
  };

  const disableOrRegenerate = async () => {
    if (!token || mfaBusy || (mfaStep !== "disable" && mfaStep !== "regenerate")) return;
    if (!mfaPassword || !mfaCode.trim()) { setMfaError(t("settings.mobile.accountSecurity.enterYourPasswordAndA")); return; }
    setMfaBusy(true); setMfaError("");
    try {
      if (mfaStep === "disable") {
        await apiJson("/api/account/mfa/disable", jsonPost({ currentPassword: mfaPassword, code: mfaCode.trim() }), token);
        resetMfaForm();
        setMfaNotice(t("settings.mobile.accountSecurity.twoFactorSignInIs2"));
      } else {
        const data = await apiJson<{ recoveryCodes?: string[] }>("/api/account/mfa/recovery-codes", jsonPost({ currentPassword: mfaPassword, code: mfaCode.trim() }), token);
        setMfaPassword(""); setMfaCode("");
        setRecoveryCodes(Array.isArray(data.recoveryCodes) ? data.recoveryCodes : []);
        setMfaStep("codes");
        setMfaNotice(t("settings.mobile.accountSecurity.newRecoveryCodesAreReady"));
      }
      void loadMfa();
    } catch (cause) { setMfaError(cause instanceof Error ? cause.message : t("settings.twoFactor.errorRetry")); }
    finally { setMfaBusy(false); }
  };

  const copyText = (value: string, message: string) => {
    Clipboard.setString(value);
    setMfaNotice(message);
  };

  const shareRecoveryCodes = () => {
    void Share.share({ title: t("settings.mobile.accountSecurity.decaveRecoveryCodes"), message: `${t("settings.mobile.accountSecurity.recoveryCodesFor", { name: user?.username ?? t("settings.mobile.accountSecurity.yourAccount") })}\n\n${recoveryCodes.join("\n")}` }).catch(() => {});
  };

  const openAuthenticator = () => {
    if (!mfaSetup) return;
    void Linking.openURL(mfaSetup.otpauth).catch(() => setMfaError(t("settings.mobile.accountSecurity.noAuthenticatorAppOpenedCopy")));
  };

  const toggleLoginAlerts = async (value: boolean) => {
    if (!token) return;
    const previous = loginAlerts;
    setLoginAlerts(value); setAlertsError("");
    try {
      const prefs = await updateAccountPreferences(token, { loginAlerts: value });
      setLoginAlerts(Boolean(prefs.loginAlerts));
    } catch (cause) {
      setLoginAlerts(previous);
      setAlertsError(cause instanceof Error ? cause.message : t("settings.mobile.accountSecurity.couldNotSaveThisSetting"));
    }
  };

  const downloadData = async () => {
    if (!token || exporting) return;
    setExporting(true); setExportError("");
    try {
      const response = await apiFetch("/api/account/export", {}, token);
      const body = await response.text();
      if (!response.ok) {
        let message = t("settings.mobile.accountSecurity.downloadFailed", { status: response.status });
        try { message = apiErrorText(JSON.parse(body) as ApiErrorBody, message); } catch {}
        throw new Error(message);
      }
      const exportStatus = accountExportStatus(body);
      if (!exportStatus.complete) {
        throw new Error(
          exportStatus.errorKey === "settings.accountExport.failed"
            ? t("settings.accountExport.failed")
            : exportStatus.errorKey === "settings.accountExport.unfinished"
              ? t("settings.accountExport.unfinished")
              : exportStatus.error,
        );
      }
      const fileName = `decave-data-${localDateStamp()}.json`;
      if (Platform.OS === "ios") {
        if (!FileSystem.cacheDirectory) throw new Error(t("settings.mobile.accountSecurity.thisPhoneHasNoSpace"));
        const fileUri = `${FileSystem.cacheDirectory}${fileName}`;
        await FileSystem.writeAsStringAsync(fileUri, body);
        await Share.share({ url: fileUri, title: fileName });
      } else {
        await Share.share({ title: fileName, message: body });
      }
    } catch (cause) {
      setExportError(cause instanceof Error ? cause.message : t("settings.mobile.accountSecurity.couldNotDownloadYourData"));
    } finally { setExporting(false); }
  };

  const signOutAfter = async (message: string) => {
    await invalidate(message);
    router.replace("/login" as any);
  };

  const updateEmail = async () => {
    if (!token || busy) return;
    setError(""); setNotice("");
    if (!email.trim() || !emailPassword) { setError(t("settings.mobile.accountSecurity.enterTheNewEmailAnd")); return; }
    setBusy(true);
    try {
      const code = emailMfaCode.trim();
      await apiJson("/api/auth/add-email", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({email:email.trim(),password:emailPassword,...(code?{mfaCode:code}:{})}) }, token);
      await refreshUser();
      setEmail(""); setEmailPassword(""); setEmailMfaCode("");
      setNotice(t("settings.mobile.accountSecurity.verificationEmailSentOpenIt"));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t("settings.mobile.accountSecurity.couldNotUpdateEmail");
      // The server asks for a second factor even if the 2FA status has not loaded.
      if (/authenticator|recovery code/i.test(message)) setEmailMfaRequired(true);
      setError(message);
      setEmailMfaCode("");
    }
    finally { setBusy(false); }
  };

  const changeUsername = async () => {
    if (!token || usernameBusy) return;
    setUsernameError(""); setUsernameNotice("");
    if (!newUsername.trim() || !usernamePassword) { setUsernameError(t("settings.mobile.accountSecurity.enterYourCurrentPassword")); return; }
    setUsernameBusy(true);
    try {
      // apiFetch rather than apiJson: a cooldown refusal carries the date it ends.
      const response = await apiFetch("/api/account/username", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: newUsername.trim(), currentPassword: usernamePassword }),
      }, token);
      const data = (await response.json().catch(() => ({}))) as ApiErrorBody & { usernameChangeAvailableAt?: unknown };
      if (typeof data.usernameChangeAvailableAt === "string") setUsernameAvailableAt(data.usernameChangeAvailableAt);
      if (!response.ok) {
        throw new Error(apiErrorText(data, t("errors.mobile.requestFailed", { status: response.status })));
      }
      await refreshUser();
      setNewUsername(""); setUsernamePassword("");
      setUsernameNotice(t("chat.actions.account.usernameUpdated"));
    } catch (cause) {
      setUsernameError(cause instanceof Error ? cause.message : t("errors.client.account.changeUsername"));
    } finally { setUsernameBusy(false); }
  };

  const changePassword = async () => {
    if (!token || busy) return;
    setError(""); setNotice("");
    if (!currentPassword || newPassword.length < 10 || newPassword !== confirmPassword) {
      setError(t("settings.mobile.accountSecurity.enterYourCurrentPasswordUse"));
      return;
    }
    setBusy(true);
    try {
      await apiJson("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      }, token);
      await signOutAfter(t("settings.mobile.accountSecurity.passwordChangedSignIn"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.mobile.accountSecurity.couldNotChangePassword"));
    } finally { setBusy(false); }
  };

  const confirmDangerAction = async () => {
    if (!token || !dangerAction || !dangerPassword || busy) { setError(t("settings.mobile.accountSecurity.enterYourCurrentPasswordTo")); return; }
    setBusy(true); setError("");
    try {
      if (dangerAction === "disable") {
        await apiJson("/api/account/disable", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword: dangerPassword }) }, token);
        await signOutAfter(t("settings.mobile.accountSecurity.accountDisabled"));
      } else {
        const result = await apiJson<{ deleteAfter?: string }>("/api/account/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword: dangerPassword, confirmUsername: user?.username ?? "" }) }, token);
        await signOutAfter(result.deleteAfter ? t("settings.mobile.accountSecurity.deletionScheduledFor", { date: new Date(result.deleteAfter).toLocaleDateString(dateLocale()) }) : t("settings.mobile.accountSecurity.deletionScheduled"));
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : (dangerAction === "disable" ? t("settings.mobile.accountSecurity.couldNotDisableAccount") : t("settings.mobile.accountSecurity.couldNotDeleteAccount"))); }
    finally { setBusy(false); }
  };

  const usernameLocked = !!usernameAvailableAt && Date.parse(usernameAvailableAt) > Date.now();

  return (
    <Screen>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("common.actions.back")} style={styles.back} onPress={() => router.back()}><Ionicons name="chevron-back" size={22} color={colors.cyan} /></Pressable>
        <View style={{ flex: 1 }}><Text maxFontSizeMultiplier={1.3} style={styles.kicker}>{t("settings.mobile.accountSecurity.settings")}</Text><Text style={styles.title}>{t("settings.mobile.settings.accountSecurity")}</Text></View>
        <Ionicons name="shield-checkmark-outline" size={22} color={colors.cyan} />
      </View>
      <ScrollView keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.section}>{t("settings.mobile.accountSecurity.username")}</Text>
        <View style={styles.card}>
          <View style={styles.emailStatus}>
            <Ionicons name="at-outline" size={20} color={colors.cyan} />
            <View style={{ flex: 1 }}>
              <Text style={styles.emailValue}>{user?.username}</Text>
              <Text style={styles.hint}>{usernameLocked && usernameAvailableAt
                ? t("settings.account.usernameAgain", { date: new Date(usernameAvailableAt).toLocaleDateString(dateLocale()) })
                : t("settings.account.usernameRule")}</Text>
            </View>
          </View>
          {!usernameLocked && (
            <>
              <View style={styles.divider} />
              <Field label={t("common.account.edit.newUsername")} value={newUsername} onChangeText={setNewUsername} secure={false} />
              <Field label={t("settings.twoFactor.currentPassword")} value={usernamePassword} onChangeText={setUsernamePassword} />
              <Pressable accessibilityRole="button" style={[styles.primary, (usernameBusy || !newUsername.trim() || !usernamePassword) && styles.disabled]} disabled={usernameBusy || !newUsername.trim() || !usernamePassword} onPress={() => void changeUsername()}><Text style={styles.primaryText}>{usernameBusy ? t("common.status.checking") : t("common.account.edit.usernameTitle")}</Text></Pressable>
              <Text style={styles.hint}>{t("common.account.edit.usernameBody")}</Text>
            </>
          )}
          {!!usernameNotice && <Text style={[styles.notice, { marginTop: 8 }]}>{usernameNotice}</Text>}
          {!!usernameError && <Text style={[styles.error, { marginTop: 8 }]}>{usernameError}</Text>}
        </View>

        <Text style={styles.section}>{t("settings.mobile.accountSecurity.emailAddress")}</Text>
        <View style={styles.card}>
          <View style={styles.emailStatus}><Ionicons name={user?.emailVerified?"checkmark-circle":"mail-outline"} size={20} color={user?.emailVerified?colors.green:colors.cyan}/><View style={{flex:1}}><Text style={styles.emailValue}>{streamerMode&&user?.email?t("settings.account.hiddenByStreamerMode"):(user?.email||t("settings.account.noEmail"))}</Text><Text style={styles.hint}>{user?.email?(user.emailVerified?t("common.auth.verifiedEmail"):t("settings.account.verificationRequired")):t("settings.mobile.accountSecurity.addAnEmailForRecovery")}</Text></View></View>
          <View style={styles.divider}/>
          <Field label={user?.email?t("settings.mobile.accountSecurity.newEmailAddress"):t("settings.mobile.accountSecurity.emailAddress2")} value={email} onChangeText={setEmail} secure={false} keyboardType="email-address" />
          <Field label={t("settings.twoFactor.currentPassword")} value={emailPassword} onChangeText={setEmailPassword} />
          {(mfa?.enabled || emailMfaRequired) && <View style={{ marginBottom: 10 }}><Text style={styles.label}>{t("settings.twoFactor.codeLabel")}</Text><TextInput value={emailMfaCode} onChangeText={(value) => setEmailMfaCode(value.toUpperCase().replace(/\s/g, "").slice(0, 19))} autoCapitalize="characters" autoCorrect={false} textContentType="oneTimeCode" autoComplete="one-time-code" accessibilityLabel={t("settings.twoFactor.codeLabel")} placeholder={t("settings.twoFactor.sixDigit")} placeholderTextColor={colors.faint} style={styles.input} /></View>}
          <Pressable accessibilityRole="button" style={[styles.primary,busy&&styles.disabled]} disabled={busy||!email.trim()||!emailPassword||((mfa?.enabled||emailMfaRequired)&&!emailMfaCode.trim())} onPress={()=>void updateEmail()}><Text style={styles.primaryText}>{user?.email?t("settings.mobile.accountSecurity.changeVerifyEmail"):t("settings.mobile.accountSecurity.addEmail")}</Text></Pressable>
        </View>

        <Text style={styles.section}>{t("settings.mobile.accountSecurity.changePassword")}</Text>
        <View style={styles.card}>
          <Field label={t("settings.twoFactor.currentPassword")} value={currentPassword} onChangeText={setCurrentPassword} />
          <Field label={t("common.account.edit.newPassword")} value={newPassword} onChangeText={setNewPassword} />
          <Field label={t("common.account.edit.confirmPassword")} value={confirmPassword} onChangeText={setConfirmPassword} />
          <Pressable accessibilityRole="button" style={[styles.primary, busy && styles.disabled]} disabled={busy} onPress={() => void changePassword()}><Text style={styles.primaryText}>{t("common.account.edit.passwordTitle")}</Text></Pressable>
          <Text style={styles.hint}>{t("settings.mobile.accountSecurity.changingYourPasswordSignsOut")}</Text>
        </View>

        <Text style={styles.section}>{t("settings.mobile.accountSecurity.twoFactorSignIn")}</Text>
        <View style={styles.card}>
          {mfaLoading ? <ActivityIndicator color={colors.cyan} style={{ marginVertical: 12 }} /> : (
            <>
              <View style={styles.emailStatus}>
                <Ionicons name={mfa?.enabled ? "lock-closed" : "lock-open-outline"} size={20} color={mfa?.enabled ? colors.green : colors.cyan} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.emailValue}>{mfa?.enabled ? t("settings.mobile.accountSecurity.twoFactorSignInIs3") : t("settings.checkup.items.twoFactor.title")}</Text>
                  <Text style={styles.hint}>{mfa?.enabled
                    ? mfa.enabledAt
                      ? t("settings.mobile.accountSecurity.turnedOn", { date: new Date(mfa.enabledAt).toLocaleDateString(dateLocale()), codes: t("settings.mobile.accountSecurity.recoveryCodesLeft", { count: mfa.recoveryCodesRemaining }) })
                      : t("settings.mobile.accountSecurity.recoveryCodesLeft", { count: mfa.recoveryCodesRemaining })
                    : t("settings.mobile.accountSecurity.askForACodeFrom")}</Text>
                </View>
              </View>

              {mfa?.enabled && mfa.recoveryCodesRemaining <= 2 && mfaStep !== "codes" && (
                <View style={styles.warn}><Ionicons name="warning-outline" size={16} color={colors.yellow} /><Text style={styles.warnText}>{t("settings.mobile.accountSecurity.youReRunningOutOf")}</Text></View>
              )}

              {mfaStep === "idle" && (
                <>
                  <View style={styles.divider} />
                  {mfa?.enabled ? (
                    <View style={styles.buttonRow}>
                      <Pressable accessibilityRole="button" style={[styles.secondary, { flex: 1 }]} onPress={() => resetMfaForm("regenerate")}><Text style={styles.secondaryText}>{t("settings.twoFactor.newCodes")}</Text></Pressable>
                      <Pressable accessibilityRole="button" style={[styles.secondaryDanger, { flex: 1 }]} onPress={() => resetMfaForm("disable")}><Text style={styles.secondaryDangerText}>{t("settings.twoFactor.turnOff")}</Text></Pressable>
                    </View>
                  ) : (
                    <Pressable accessibilityRole="button" style={styles.primary} onPress={() => resetMfaForm("password")}><Text style={styles.primaryText}>{t("settings.twoFactor.turnOnTwoFactor")}</Text></Pressable>
                  )}
                </>
              )}

              {mfaStep === "password" && (
                <>
                  <View style={styles.divider} />
                  <Text style={styles.stepText}>{t("settings.mobile.accountSecurity.firstConfirmItSYou")}</Text>
                  <Field label={t("settings.twoFactor.currentPassword")} value={mfaPassword} onChangeText={setMfaPassword} />
                  <View style={styles.buttonRow}>
                    <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => resetMfaForm()} disabled={mfaBusy}><Text style={styles.secondaryText}>{t("common.actions.cancel")}</Text></Pressable>
                    <Pressable accessibilityRole="button" style={[styles.primary, { flex: 1, marginTop: 0 }, (mfaBusy || !mfaPassword) && styles.disabled]} disabled={mfaBusy || !mfaPassword} onPress={() => void startMfaSetup()}><Text style={styles.primaryText}>{mfaBusy ? t("common.status.checking") : t("common.actions.continue")}</Text></Pressable>
                  </View>
                </>
              )}

              {mfaStep === "setup" && mfaSetup && (
                <>
                  <View style={styles.divider} />
                  <Text style={styles.stepText}>{t("settings.mobile.accountSecurity.n1AddDecaveToYour")}</Text>
                  <View style={styles.secretBox}>
                    <Text style={styles.secret} selectable>{groupSecret(mfaSetup.secret)}</Text>
                  </View>
                  <View style={styles.buttonRow}>
                    <Pressable accessibilityRole="button" style={[styles.secondary, { flex: 1 }]} onPress={() => copyText(mfaSetup.secret.replace(/\s/g, ""), t("settings.mobile.accountSecurity.keyCopied"))}><Ionicons name="copy-outline" size={15} color={colors.cyan} /><Text style={styles.secondaryText}>{t("settings.mobile.accountSecurity.copyKey")}</Text></Pressable>
                    <Pressable accessibilityRole="button" style={[styles.secondary, { flex: 1 }]} onPress={openAuthenticator}><Ionicons name="open-outline" size={15} color={colors.cyan} /><Text style={styles.secondaryText}>{t("settings.mobile.accountSecurity.openInAuthenticatorApp")}</Text></Pressable>
                  </View>
                  <Text style={[styles.stepText, { marginTop: 12 }]}>{t("settings.mobile.accountSecurity.n2EnterThe6Digit")}</Text>
                  <TextInput value={mfaCode} onChangeText={(value) => setMfaCode(value.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code" placeholder="123456" placeholderTextColor={colors.faint} style={[styles.input, styles.codeInput]} maxLength={6} />
                  <View style={[styles.buttonRow, { marginTop: 10 }]}>
                    <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => resetMfaForm()} disabled={mfaBusy}><Text style={styles.secondaryText}>{t("common.actions.cancel")}</Text></Pressable>
                    <Pressable accessibilityRole="button" style={[styles.primary, { flex: 1, marginTop: 0 }, (mfaBusy || mfaCode.length !== 6) && styles.disabled]} disabled={mfaBusy || mfaCode.length !== 6} onPress={() => void enableMfa()}><Text style={styles.primaryText}>{mfaBusy ? t("common.status.checking") : t("settings.twoFactor.turnOn")}</Text></Pressable>
                  </View>
                </>
              )}

              {(mfaStep === "disable" || mfaStep === "regenerate") && (
                <>
                  <View style={styles.divider} />
                  <Text style={styles.stepText}>{mfaStep === "disable" ? t("settings.mobile.accountSecurity.toTurnOffTwoFactor") : t("settings.mobile.accountSecurity.toMakeNewRecoveryCodes")}</Text>
                  <Field label={t("settings.twoFactor.currentPassword")} value={mfaPassword} onChangeText={setMfaPassword} />
                  <View style={{ marginBottom: 10 }}>
                    <Text style={styles.label}>{t("settings.mobile.accountSecurity.authenticatorCode")}</Text>
                    <TextInput value={mfaCode} onChangeText={(value) => setMfaCode(value.toUpperCase().replace(/\s/g, "").slice(0, 19))} autoCapitalize="characters" autoCorrect={false} textContentType="oneTimeCode" autoComplete="one-time-code" placeholder={t("settings.twoFactor.sixDigit")} placeholderTextColor={colors.faint} style={styles.input} />
                  </View>
                  <View style={styles.buttonRow}>
                    <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => resetMfaForm()} disabled={mfaBusy}><Text style={styles.secondaryText}>{t("common.actions.cancel")}</Text></Pressable>
                    <Pressable accessibilityRole="button" style={[mfaStep === "disable" ? styles.confirmDanger : styles.primary, { flex: 1, marginTop: 0 }, (mfaBusy || !mfaPassword || !mfaCode) && styles.disabled]} disabled={mfaBusy || !mfaPassword || !mfaCode} onPress={() => void disableOrRegenerate()}>
                      <Text style={mfaStep === "disable" ? styles.confirmDangerText : styles.primaryText}>{mfaBusy ? t("common.status.checking") : mfaStep === "disable" ? t("settings.twoFactor.turnOff") : t("settings.twoFactor.makeNewCodes")}</Text>
                    </Pressable>
                  </View>
                </>
              )}

              {mfaStep === "codes" && (
                <>
                  <View style={styles.divider} />
                  <Text style={styles.stepText}>{t("settings.mobile.accountSecurity.saveTheseRecoveryCodesSomewhere")}</Text>
                  <View style={styles.codesGrid}>
                    {recoveryCodes.map((code) => <Text key={code} style={styles.recoveryCode} selectable>{code}</Text>)}
                  </View>
                  <View style={styles.buttonRow}>
                    <Pressable accessibilityRole="button" style={[styles.secondary, { flex: 1 }]} onPress={() => copyText(recoveryCodes.join("\n"), t("settings.mobile.accountSecurity.recoveryCodesCopied"))}><Ionicons name="copy-outline" size={15} color={colors.cyan} /><Text style={styles.secondaryText}>{t("common.actions.copy")}</Text></Pressable>
                    <Pressable accessibilityRole="button" style={[styles.secondary, { flex: 1 }]} onPress={shareRecoveryCodes}><Ionicons name="share-outline" size={15} color={colors.cyan} /><Text style={styles.secondaryText}>{t("common.actions.share")}</Text></Pressable>
                  </View>
                  <Pressable accessibilityRole="button" style={[styles.primary, { marginTop: 10 }]} onPress={() => { setRecoveryCodes([]); resetMfaForm(); }}><Text style={styles.primaryText}>{t("settings.twoFactor.savedThem")}</Text></Pressable>
                </>
              )}

              {!!mfaNotice && <Text style={[styles.notice, { marginTop: 8 }]}>{mfaNotice}</Text>}
              {!!mfaError && <Text style={[styles.error, { marginTop: 8 }]}>{mfaError}</Text>}
            </>
          )}
        </View>

        <Text style={styles.section}>{t("settings.mobile.accountSecurity.signInAlerts")}</Text>
        <View style={styles.card}>
          <View style={styles.toggleRow}>
            <Ionicons name="mail-unread-outline" size={19} color={colors.cyan} />
            <View style={{ flex: 1 }}>
              <Text style={styles.emailValue}>{t("settings.account.loginAlerts")}</Text>
              <Text style={styles.hint}>{t("settings.mobile.accountSecurity.whenANewDeviceApp")}</Text>
            </View>
            {loginAlerts === null && !alertsError ? <ActivityIndicator color={colors.cyan} /> : (
              <Switch value={Boolean(loginAlerts)} disabled={loginAlerts === null} onValueChange={(value) => void toggleLoginAlerts(value)} trackColor={{ false: "#263148", true: colors.violet }} thumbColor="#EEF4FF" accessibilityLabel={t("settings.account.loginAlerts")} />
            )}
          </View>
          {!user?.email && <Text style={styles.hint}>{t("settings.mobile.accountSecurity.addAnEmailAddressAbove")}</Text>}
          {!!alertsError && <Text style={[styles.error, { marginTop: 6 }]}>{alertsError}</Text>}
        </View>

        <Text style={styles.section}>{t("settings.mobile.accountSecurity.yourData")}</Text>
        <View style={styles.card}>
          <Pressable accessibilityRole="button" style={styles.dangerRow} onPress={() => void downloadData()} disabled={exporting}>
            {exporting ? <ActivityIndicator color={colors.cyan} /> : <Ionicons name="download-outline" size={19} color={colors.cyan} />}
            <View style={{ flex: 1 }}>
              <Text style={styles.emailValue}>{exporting ? t("settings.mobile.accountSecurity.preparingYourFile") : t("settings.yourData.title")}</Text>
              <Text style={styles.hint}>{t("settings.mobile.accountSecurity.getACopyOfYour")}</Text>
            </View>
            <Ionicons name="chevron-forward" size={17} color={colors.muted} />
          </Pressable>
          {!!exportError && <Text style={[styles.error, { marginTop: 6 }]}>{exportError}</Text>}
        </View>

        <Text style={styles.section}>{t("settings.mobile.accountSecurity.accountState")}</Text>
        <View style={styles.card}>
          <Pressable accessibilityRole="button" style={styles.dangerRow} onPress={()=>{setDangerPassword("");setDangerAction("disable");}}><Ionicons name="pause-circle-outline" size={19} color={colors.red} /><View style={{ flex: 1 }}><Text style={styles.dangerTitle}>{t("settings.mobile.accountSecurity.disableAccount")}</Text><Text style={styles.hint}>{t("settings.mobile.accountSecurity.endsActiveSessionsYourNext")}</Text></View></Pressable>
          <View style={styles.divider} />
          <Pressable accessibilityRole="button" style={styles.dangerRow} onPress={()=>{setDangerPassword("");setDangerAction("delete");}}><Ionicons name="trash-outline" size={19} color={colors.red} /><View style={{ flex: 1 }}><Text style={styles.dangerTitle}>{t("settings.mobile.accountSecurity.deleteAccount")}</Text><Text style={styles.hint}>{t("settings.mobile.accountSecurity.schedulesDeletionAfter30Days")}</Text></View></Pressable>
        </View>

        {!!notice && <Text style={styles.notice}>{notice}</Text>}
        {!!error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>
      <Modal visible={dangerAction!==null} transparent animationType="fade" onRequestClose={()=>setDangerAction(null)}>
        <Pressable style={styles.overlay} onPress={()=>setDangerAction(null)}><Pressable accessibilityRole="button" style={styles.confirmCard} onPress={()=>{}}>
          <Ionicons name={dangerAction==="delete"?"warning-outline":"pause-circle-outline"} size={26} color={colors.red}/>
          <Text style={styles.confirmTitle}>{dangerAction==="delete"?t("settings.account.delete"):t("settings.account.disable")}</Text>
          <Text style={styles.confirmText}>{dangerAction==="delete"?t("settings.mobile.accountSecurity.yourAccountWillBeScheduled"):t("settings.mobile.accountSecurity.yourAccountAndActiveSessions")}</Text>
          <Field label={t("settings.twoFactor.currentPassword")} value={dangerPassword} onChangeText={setDangerPassword} />
          <View style={styles.confirmActions}><Pressable accessibilityRole="button" style={styles.cancel} onPress={()=>setDangerAction(null)}><Text style={styles.cancelText}>{t("common.actions.cancel")}</Text></Pressable><Pressable accessibilityRole="button" style={[styles.confirmDanger,(!dangerPassword||busy)&&styles.disabled]} disabled={!dangerPassword||busy} onPress={()=>void confirmDangerAction()}><Text style={styles.confirmDangerText}>{dangerAction==="delete"?t("common.actions.delete"):t("common.actions.disable")}</Text></Pressable></View>
        </Pressable></Pressable>
      </Modal>
    </Screen>
  );
}

type MfaStatus = { enabled: boolean; enabledAt: string | null; recoveryCodesRemaining: number };
type MfaStep = "idle" | "password" | "setup" | "codes" | "disable" | "regenerate";

function jsonPost(body: unknown): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

function groupSecret(secret: string): string {
  return (secret.replace(/\s/g, "").match(/.{1,4}/g) ?? []).join(" ");
}

function localDateStamp(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function Field({ label, value, onChangeText, secure=true, keyboardType="default" }: { label: string; value: string; onChangeText: (value: string) => void; secure?:boolean; keyboardType?:"default"|"email-address"|"number-pad" }) {
  return <View style={{ marginBottom: 10 }}><Text style={styles.label}>{label}</Text><TextInput value={value} onChangeText={onChangeText} secureTextEntry={secure} keyboardType={keyboardType} autoCapitalize="none" autoCorrect={false} style={styles.input} placeholderTextColor={colors.faint} /></View>;
}

const styles = StyleSheet.create({
  top: { minHeight: 76, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.bg },
  back: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border }, kicker: { color: colors.cyan, fontSize: 11, fontWeight: "900", letterSpacing: 1.8 }, title: { color: colors.text, fontSize: 20, fontWeight: "900" },
  scroll: { padding: 14, paddingBottom: 45 }, section: { color: colors.faint, fontSize: 13, fontWeight: "900", letterSpacing: 1.4, marginTop: 7, marginBottom: 7 }, card: { padding: 12, borderRadius: 18, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border, marginBottom: 12 },
  label: { color: colors.muted, fontSize: 11, fontWeight: "800", marginBottom: 5 }, input: { minHeight: 44, borderRadius: 12, paddingHorizontal: 11, color: colors.text, backgroundColor: colors.input, borderWidth: 1, borderColor: colors.border, fontSize: 13 },
  emailStatus:{minHeight:48,flexDirection:"row",alignItems:"center",gap:10},emailValue:{color:colors.text,fontSize:13,fontWeight:"900"},
  primary: { minHeight: 43, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.cyan, marginTop: 2 }, primaryText: { color: "#061018", fontSize: 12, fontWeight: "900" }, disabled: { opacity: .55 }, hint: { color: colors.muted, fontSize: 13, lineHeight: 12, marginTop: 5 },
  dangerRow: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7 }, dangerTitle: { color: colors.red, fontSize: 12, fontWeight: "900" }, divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: 9 }, error: { color: colors.red, fontSize: 12, lineHeight: 14, marginTop: 2 }, notice: { color: colors.green, fontSize: 12, marginTop: 2 },
  stepText: { color: colors.text, fontSize: 13, lineHeight: 18, marginBottom: 10 },
  buttonRow: { flexDirection: "row", gap: 8 },
  secondary: { minHeight: 43, paddingHorizontal: 12, flexDirection: "row", gap: 6, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.cyanSoft, borderWidth: 1, borderColor: "rgba(95,225,255,.24)" },
  secondaryText: { color: colors.cyan, fontSize: 12, fontWeight: "900", flexShrink: 1, textAlign: "center" },
  secondaryDanger: { minHeight: 43, paddingHorizontal: 12, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.redSoft, borderWidth: 1, borderColor: "rgba(255,102,120,.24)" },
  secondaryDangerText: { color: colors.red, fontSize: 12, fontWeight: "900" },
  secretBox: { padding: 12, borderRadius: 12, backgroundColor: colors.input, borderWidth: 1, borderColor: colors.border, marginBottom: 10 },
  secret: { color: colors.text, fontSize: 16, fontWeight: "800", letterSpacing: 1.5, textAlign: "center", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  codeInput: { fontSize: 20, letterSpacing: 6, textAlign: "center", fontWeight: "800" },
  codesGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 },
  recoveryCode: { width: "48%", flexGrow: 1, paddingVertical: 8, borderRadius: 10, overflow: "hidden", textAlign: "center", color: colors.text, backgroundColor: colors.input, borderWidth: 1, borderColor: colors.border, fontSize: 12, fontWeight: "800", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  warn: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10, padding: 10, borderRadius: 12, backgroundColor: "rgba(255,198,92,.10)", borderWidth: 1, borderColor: "rgba(255,198,92,.24)" },
  warnText: { flex: 1, color: colors.yellow, fontSize: 12, lineHeight: 16 },
  toggleRow: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 10 },
  overlay:{flex:1,justifyContent:"center",padding:24,backgroundColor:colors.overlay},confirmCard:{padding:18,borderRadius:20,backgroundColor:colors.panel,borderWidth:1,borderColor:colors.borderStrong},confirmTitle:{color:colors.text,fontSize:17,fontWeight:"900",marginTop:10},confirmText:{color:colors.muted,fontSize:12,lineHeight:15,marginTop:5,marginBottom:16},confirmActions:{flexDirection:"row",gap:8,justifyContent:"flex-end"},cancel:{minHeight:42,paddingHorizontal:15,borderRadius:11,alignItems:"center",justifyContent:"center",backgroundColor:colors.panel2},cancelText:{color:colors.text,fontSize:12,fontWeight:"900"},confirmDanger:{minHeight:42,paddingHorizontal:15,borderRadius:11,alignItems:"center",justifyContent:"center",backgroundColor:colors.red},confirmDangerText:{color:"#fff",fontSize:12,fontWeight:"900"},
});
