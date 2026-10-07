import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Clipboard, Linking, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { accountExportStatus } from "../../shared/account-export";
import { router } from "expo-router";
import * as FileSystem from "expo-file-system/legacy";
import { Screen } from "@/src/components/Screen";
import { apiFetch, apiJson } from "@/src/lib/api";
import { loadAccountPreferences, updateAccountPreferences } from "@/src/lib/account-preferences";
import { useSession } from "@/src/providers/SessionProvider";
import { colors } from "@/src/theme";

export default function AccountSecurityScreen() {
  const { token, user, invalidate, refreshUser } = useSession();
  const [email, setEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [emailMfaCode, setEmailMfaCode] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [dangerAction, setDangerAction] = useState<"disable" | "delete" | null>(null);
  const [dangerPassword, setDangerPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

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
      setMfaError(cause instanceof Error ? cause.message : "Could not load two-factor settings.");
    } finally {
      setMfaLoading(false);
    }
  }, [token]);

  useEffect(() => { void loadMfa(); }, [loadMfa]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    loadAccountPreferences(token)
      .then((prefs) => { if (active) setLoginAlerts(Boolean(prefs.loginAlerts)); })
      .catch((cause) => { if (active) setAlertsError(cause instanceof Error ? cause.message : "Could not load this setting."); });
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
    if (!mfaPassword) { setMfaError("Enter your current password."); return; }
    setMfaBusy(true); setMfaError("");
    try {
      const data = await apiJson<{ secret: string; otpauth: string }>("/api/account/mfa/setup", jsonPost({ currentPassword: mfaPassword }), token);
      setMfaSetup(data);
      setMfaPassword("");
      setMfaCode("");
      setMfaStep("setup");
    } catch (cause) { setMfaError(cause instanceof Error ? cause.message : "Could not start setup."); }
    finally { setMfaBusy(false); }
  };

  const enableMfa = async () => {
    if (!token || mfaBusy) return;
    if (!/^\d{6}$/.test(mfaCode)) { setMfaError("Enter the 6-digit code from your authenticator app."); return; }
    setMfaBusy(true); setMfaError("");
    try {
      const data = await apiJson<{ enabled: boolean; recoveryCodes?: string[] }>("/api/account/mfa/enable", jsonPost({ code: mfaCode }), token);
      setMfaSetup(null);
      setMfaCode("");
      setRecoveryCodes(Array.isArray(data.recoveryCodes) ? data.recoveryCodes : []);
      setMfaStep("codes");
      setMfaNotice("Two-factor sign-in is on.");
      void loadMfa();
    } catch (cause) { setMfaError(cause instanceof Error ? cause.message : "That code didn't work. Try again."); }
    finally { setMfaBusy(false); }
  };

  const disableOrRegenerate = async () => {
    if (!token || mfaBusy || (mfaStep !== "disable" && mfaStep !== "regenerate")) return;
    if (!mfaPassword || !mfaCode.trim()) { setMfaError("Enter your password and a code from your authenticator app."); return; }
    setMfaBusy(true); setMfaError("");
    try {
      if (mfaStep === "disable") {
        await apiJson("/api/account/mfa/disable", jsonPost({ currentPassword: mfaPassword, code: mfaCode.trim() }), token);
        resetMfaForm();
        setMfaNotice("Two-factor sign-in is off.");
      } else {
        const data = await apiJson<{ recoveryCodes?: string[] }>("/api/account/mfa/recovery-codes", jsonPost({ currentPassword: mfaPassword, code: mfaCode.trim() }), token);
        setMfaPassword(""); setMfaCode("");
        setRecoveryCodes(Array.isArray(data.recoveryCodes) ? data.recoveryCodes : []);
        setMfaStep("codes");
        setMfaNotice("New recovery codes are ready. Your old codes no longer work.");
      }
      void loadMfa();
    } catch (cause) { setMfaError(cause instanceof Error ? cause.message : "Something went wrong. Try again."); }
    finally { setMfaBusy(false); }
  };

  const copyText = (value: string, message: string) => {
    Clipboard.setString(value);
    setMfaNotice(message);
  };

  const shareRecoveryCodes = () => {
    void Share.share({ title: "DeCave recovery codes", message: `DeCave recovery codes for ${user?.username ?? "your account"}\n\n${recoveryCodes.join("\n")}` }).catch(() => {});
  };

  const openAuthenticator = () => {
    if (!mfaSetup) return;
    void Linking.openURL(mfaSetup.otpauth).catch(() => setMfaError("No authenticator app opened. Copy the key and add it by hand."));
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
      setAlertsError(cause instanceof Error ? cause.message : "Could not save this setting.");
    }
  };

  const downloadData = async () => {
    if (!token || exporting) return;
    setExporting(true); setExportError("");
    try {
      const response = await apiFetch("/api/account/export", {}, token);
      const body = await response.text();
      if (!response.ok) {
        let message = `Download failed (${response.status})`;
        try { message = (JSON.parse(body) as { error?: string }).error || message; } catch {}
        throw new Error(message);
      }
      const exportStatus = accountExportStatus(body);
      if (!exportStatus.complete) throw new Error(exportStatus.error);
      const fileName = `decave-data-${localDateStamp()}.json`;
      if (Platform.OS === "ios") {
        if (!FileSystem.cacheDirectory) throw new Error("This phone has no space to save the file.");
        const fileUri = `${FileSystem.cacheDirectory}${fileName}`;
        await FileSystem.writeAsStringAsync(fileUri, body);
        await Share.share({ url: fileUri, title: fileName });
      } else {
        await Share.share({ title: fileName, message: body });
      }
    } catch (cause) {
      setExportError(cause instanceof Error ? cause.message : "Could not download your data.");
    } finally { setExporting(false); }
  };

  const signOutAfter = async (message: string) => {
    await invalidate(message);
    router.replace("/login" as any);
  };

  const updateEmail = async () => {
    if (!token || busy) return;
    setError(""); setNotice("");
    if (!email.trim() || !emailPassword) { setError("Enter the new email and your current password."); return; }
    setBusy(true);
    try {
      await apiJson("/api/auth/add-email", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({email:email.trim(),password:emailPassword,...(emailMfaCode.trim()?{mfaCode:emailMfaCode.trim()}: {})}) }, token);
      await refreshUser();
      setEmail(""); setEmailPassword(""); setEmailMfaCode("");
      setNotice("Verification email sent. Open it to verify your new address.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update email."); }
    finally { setBusy(false); }
  };

  const changePassword = async () => {
    if (!token || busy) return;
    setError(""); setNotice("");
    if (!currentPassword || newPassword.length < 10 || newPassword !== confirmPassword) {
      setError("Enter your current password, use at least 10 characters, and make the new passwords match.");
      return;
    }
    setBusy(true);
    try {
      await apiJson("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      }, token);
      await signOutAfter("Password changed. Sign in again with your new password.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not change password.");
    } finally { setBusy(false); }
  };

  const confirmDangerAction = async () => {
    if (!token || !dangerAction || !dangerPassword || busy) { setError("Enter your current password to continue."); return; }
    setBusy(true); setError("");
    try {
      if (dangerAction === "disable") {
        await apiJson("/api/account/disable", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword: dangerPassword }) }, token);
        await signOutAfter("Your DeCave account was disabled.");
      } else {
        const result = await apiJson<{ deleteAfter?: string }>("/api/account/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword: dangerPassword, confirmUsername: user?.username ?? "" }) }, token);
        await signOutAfter(result.deleteAfter ? `Account deletion scheduled for ${new Date(result.deleteAfter).toLocaleDateString()}.` : "Account deletion scheduled.");
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : `Could not ${dangerAction} account.`); }
    finally { setBusy(false); }
  };

  return (
    <Screen>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" style={styles.back} onPress={() => router.back()}><Ionicons name="chevron-back" size={22} color={colors.cyan} /></Pressable>
        <View style={{ flex: 1 }}><Text maxFontSizeMultiplier={1.3} style={styles.kicker}>SETTINGS</Text><Text style={styles.title}>Account & Security</Text></View>
        <Ionicons name="shield-checkmark-outline" size={22} color={colors.cyan} />
      </View>
      <ScrollView keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.section}>EMAIL ADDRESS</Text>
        <View style={styles.card}>
          <View style={styles.emailStatus}><Ionicons name={user?.emailVerified?"checkmark-circle":"mail-outline"} size={20} color={user?.emailVerified?colors.green:colors.cyan}/><View style={{flex:1}}><Text style={styles.emailValue}>{user?.email||"No email added"}</Text><Text style={styles.hint}>{user?.email?(user.emailVerified?"Verified email":"Verification required"):"Add an email for recovery and account protection."}</Text></View></View>
          <View style={styles.divider}/>
          <Field label={user?.email?"New email address":"Email address"} value={email} onChangeText={setEmail} secure={false} keyboardType="email-address" />
          <Field label="Current password" value={emailPassword} onChangeText={setEmailPassword} />
          {mfa?.enabled && <Field label="Authenticator or recovery code" value={emailMfaCode} onChangeText={setEmailMfaCode} secure={false} keyboardType="number-pad" />}
          <Pressable accessibilityRole="button" style={[styles.primary,busy&&styles.disabled]} disabled={busy||!email.trim()||!emailPassword} onPress={()=>void updateEmail()}><Text style={styles.primaryText}>{user?.email?"Change / Verify Email":"Add Email"}</Text></Pressable>
        </View>

        <Text style={styles.section}>CHANGE PASSWORD</Text>
        <View style={styles.card}>
          <Field label="Current password" value={currentPassword} onChangeText={setCurrentPassword} />
          <Field label="New password" value={newPassword} onChangeText={setNewPassword} />
          <Field label="Confirm new password" value={confirmPassword} onChangeText={setConfirmPassword} />
          <Pressable accessibilityRole="button" style={[styles.primary, busy && styles.disabled]} disabled={busy} onPress={() => void changePassword()}><Text style={styles.primaryText}>Change password</Text></Pressable>
          <Text style={styles.hint}>Changing your password signs out every active DeCave session.</Text>
        </View>

        <Text style={styles.section}>TWO-FACTOR SIGN-IN</Text>
        <View style={styles.card}>
          {mfaLoading ? <ActivityIndicator color={colors.cyan} style={{ marginVertical: 12 }} /> : (
            <>
              <View style={styles.emailStatus}>
                <Ionicons name={mfa?.enabled ? "lock-closed" : "lock-open-outline"} size={20} color={mfa?.enabled ? colors.green : colors.cyan} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.emailValue}>{mfa?.enabled ? "Two-factor sign-in is on" : "Two-factor sign-in is off"}</Text>
                  <Text style={styles.hint}>{mfa?.enabled
                    ? `${mfa.enabledAt ? `Turned on ${new Date(mfa.enabledAt).toLocaleDateString()}. ` : ""}${mfa.recoveryCodesRemaining} recovery code${mfa.recoveryCodesRemaining === 1 ? "" : "s"} left.`
                    : "Ask for a code from an authenticator app each time you sign in."}</Text>
                </View>
              </View>

              {mfa?.enabled && mfa.recoveryCodesRemaining <= 2 && mfaStep !== "codes" && (
                <View style={styles.warn}><Ionicons name="warning-outline" size={16} color={colors.yellow} /><Text style={styles.warnText}>You're running out of recovery codes. Make new ones so you don't get locked out.</Text></View>
              )}

              {mfaStep === "idle" && (
                <>
                  <View style={styles.divider} />
                  {mfa?.enabled ? (
                    <View style={styles.buttonRow}>
                      <Pressable accessibilityRole="button" style={[styles.secondary, { flex: 1 }]} onPress={() => resetMfaForm("regenerate")}><Text style={styles.secondaryText}>New recovery codes</Text></Pressable>
                      <Pressable accessibilityRole="button" style={[styles.secondaryDanger, { flex: 1 }]} onPress={() => resetMfaForm("disable")}><Text style={styles.secondaryDangerText}>Turn off</Text></Pressable>
                    </View>
                  ) : (
                    <Pressable accessibilityRole="button" style={styles.primary} onPress={() => resetMfaForm("password")}><Text style={styles.primaryText}>Turn on two-factor</Text></Pressable>
                  )}
                </>
              )}

              {mfaStep === "password" && (
                <>
                  <View style={styles.divider} />
                  <Text style={styles.stepText}>First, confirm it's you.</Text>
                  <Field label="Current password" value={mfaPassword} onChangeText={setMfaPassword} />
                  <View style={styles.buttonRow}>
                    <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => resetMfaForm()} disabled={mfaBusy}><Text style={styles.secondaryText}>Cancel</Text></Pressable>
                    <Pressable accessibilityRole="button" style={[styles.primary, { flex: 1, marginTop: 0 }, (mfaBusy || !mfaPassword) && styles.disabled]} disabled={mfaBusy || !mfaPassword} onPress={() => void startMfaSetup()}><Text style={styles.primaryText}>{mfaBusy ? "Checking…" : "Continue"}</Text></Pressable>
                  </View>
                </>
              )}

              {mfaStep === "setup" && mfaSetup && (
                <>
                  <View style={styles.divider} />
                  <Text style={styles.stepText}>1. Add DeCave to your authenticator app. Tap the button below, or copy this key into the app.</Text>
                  <View style={styles.secretBox}>
                    <Text style={styles.secret} selectable>{groupSecret(mfaSetup.secret)}</Text>
                  </View>
                  <View style={styles.buttonRow}>
                    <Pressable accessibilityRole="button" style={[styles.secondary, { flex: 1 }]} onPress={() => copyText(mfaSetup.secret.replace(/\s/g, ""), "Key copied.")}><Ionicons name="copy-outline" size={15} color={colors.cyan} /><Text style={styles.secondaryText}>Copy key</Text></Pressable>
                    <Pressable accessibilityRole="button" style={[styles.secondary, { flex: 1 }]} onPress={openAuthenticator}><Ionicons name="open-outline" size={15} color={colors.cyan} /><Text style={styles.secondaryText}>Open in authenticator app</Text></Pressable>
                  </View>
                  <Text style={[styles.stepText, { marginTop: 12 }]}>2. Enter the 6-digit code the app shows.</Text>
                  <TextInput value={mfaCode} onChangeText={(value) => setMfaCode(value.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code" placeholder="123456" placeholderTextColor={colors.faint} style={[styles.input, styles.codeInput]} maxLength={6} />
                  <View style={[styles.buttonRow, { marginTop: 10 }]}>
                    <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => resetMfaForm()} disabled={mfaBusy}><Text style={styles.secondaryText}>Cancel</Text></Pressable>
                    <Pressable accessibilityRole="button" style={[styles.primary, { flex: 1, marginTop: 0 }, (mfaBusy || mfaCode.length !== 6) && styles.disabled]} disabled={mfaBusy || mfaCode.length !== 6} onPress={() => void enableMfa()}><Text style={styles.primaryText}>{mfaBusy ? "Checking…" : "Turn on"}</Text></Pressable>
                  </View>
                </>
              )}

              {(mfaStep === "disable" || mfaStep === "regenerate") && (
                <>
                  <View style={styles.divider} />
                  <Text style={styles.stepText}>{mfaStep === "disable" ? "To turn off two-factor, enter your password and a code from your authenticator app." : "To make new recovery codes, enter your password and a code from your authenticator app. Your old codes will stop working."}</Text>
                  <Field label="Current password" value={mfaPassword} onChangeText={setMfaPassword} />
                  <View style={{ marginBottom: 10 }}>
                    <Text style={styles.label}>Authenticator code</Text>
                    <TextInput value={mfaCode} onChangeText={(value) => setMfaCode(value.toUpperCase().replace(/\s/g, "").slice(0, 19))} autoCapitalize="characters" autoCorrect={false} textContentType="oneTimeCode" autoComplete="one-time-code" placeholder="6-digit code" placeholderTextColor={colors.faint} style={styles.input} />
                  </View>
                  <View style={styles.buttonRow}>
                    <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => resetMfaForm()} disabled={mfaBusy}><Text style={styles.secondaryText}>Cancel</Text></Pressable>
                    <Pressable accessibilityRole="button" style={[mfaStep === "disable" ? styles.confirmDanger : styles.primary, { flex: 1, marginTop: 0 }, (mfaBusy || !mfaPassword || !mfaCode) && styles.disabled]} disabled={mfaBusy || !mfaPassword || !mfaCode} onPress={() => void disableOrRegenerate()}>
                      <Text style={mfaStep === "disable" ? styles.confirmDangerText : styles.primaryText}>{mfaBusy ? "Checking…" : mfaStep === "disable" ? "Turn off" : "Make new codes"}</Text>
                    </Pressable>
                  </View>
                </>
              )}

              {mfaStep === "codes" && (
                <>
                  <View style={styles.divider} />
                  <Text style={styles.stepText}>Save these recovery codes somewhere safe. Each one works once if you lose your phone. You won't see them again.</Text>
                  <View style={styles.codesGrid}>
                    {recoveryCodes.map((code) => <Text key={code} style={styles.recoveryCode} selectable>{code}</Text>)}
                  </View>
                  <View style={styles.buttonRow}>
                    <Pressable accessibilityRole="button" style={[styles.secondary, { flex: 1 }]} onPress={() => copyText(recoveryCodes.join("\n"), "Recovery codes copied.")}><Ionicons name="copy-outline" size={15} color={colors.cyan} /><Text style={styles.secondaryText}>Copy</Text></Pressable>
                    <Pressable accessibilityRole="button" style={[styles.secondary, { flex: 1 }]} onPress={shareRecoveryCodes}><Ionicons name="share-outline" size={15} color={colors.cyan} /><Text style={styles.secondaryText}>Share</Text></Pressable>
                  </View>
                  <Pressable accessibilityRole="button" style={[styles.primary, { marginTop: 10 }]} onPress={() => { setRecoveryCodes([]); resetMfaForm(); }}><Text style={styles.primaryText}>I saved them</Text></Pressable>
                </>
              )}

              {!!mfaNotice && <Text style={[styles.notice, { marginTop: 8 }]}>{mfaNotice}</Text>}
              {!!mfaError && <Text style={[styles.error, { marginTop: 8 }]}>{mfaError}</Text>}
            </>
          )}
        </View>

        <Text style={styles.section}>SIGN-IN ALERTS</Text>
        <View style={styles.card}>
          <View style={styles.toggleRow}>
            <Ionicons name="mail-unread-outline" size={19} color={colors.cyan} />
            <View style={{ flex: 1 }}>
              <Text style={styles.emailValue}>Email me about new sign-ins</Text>
              <Text style={styles.hint}>When a new device, app or country signs in, we email you with a 'This wasn't me' button.</Text>
            </View>
            {loginAlerts === null && !alertsError ? <ActivityIndicator color={colors.cyan} /> : (
              <Switch value={Boolean(loginAlerts)} disabled={loginAlerts === null} onValueChange={(value) => void toggleLoginAlerts(value)} trackColor={{ false: "#263148", true: colors.violet }} thumbColor="#EEF4FF" accessibilityLabel="Email me about new sign-ins" />
            )}
          </View>
          {!user?.email && <Text style={styles.hint}>Add an email address above to get these alerts.</Text>}
          {!!alertsError && <Text style={[styles.error, { marginTop: 6 }]}>{alertsError}</Text>}
        </View>

        <Text style={styles.section}>YOUR DATA</Text>
        <View style={styles.card}>
          <Pressable accessibilityRole="button" style={styles.dangerRow} onPress={() => void downloadData()} disabled={exporting}>
            {exporting ? <ActivityIndicator color={colors.cyan} /> : <Ionicons name="download-outline" size={19} color={colors.cyan} />}
            <View style={{ flex: 1 }}>
              <Text style={styles.emailValue}>{exporting ? "Preparing your file…" : "Download my data"}</Text>
              <Text style={styles.hint}>Get a copy of your account, profile and messages as a file.</Text>
            </View>
            <Ionicons name="chevron-forward" size={17} color={colors.muted} />
          </Pressable>
          {!!exportError && <Text style={[styles.error, { marginTop: 6 }]}>{exportError}</Text>}
        </View>

        <Text style={styles.section}>ACCOUNT STATE</Text>
        <View style={styles.card}>
          <Pressable accessibilityRole="button" style={styles.dangerRow} onPress={()=>{setDangerPassword("");setDangerAction("disable");}}><Ionicons name="pause-circle-outline" size={19} color={colors.red} /><View style={{ flex: 1 }}><Text style={styles.dangerTitle}>Disable Account</Text><Text style={styles.hint}>Ends active sessions. Your next successful login reactivates the account.</Text></View></Pressable>
          <View style={styles.divider} />
          <Pressable accessibilityRole="button" style={styles.dangerRow} onPress={()=>{setDangerPassword("");setDangerAction("delete");}}><Ionicons name="trash-outline" size={19} color={colors.red} /><View style={{ flex: 1 }}><Text style={styles.dangerTitle}>Delete Account</Text><Text style={styles.hint}>Schedules deletion after 30 days. Log in before then to cancel.</Text></View></Pressable>
        </View>

        {!!notice && <Text style={styles.notice}>{notice}</Text>}
        {!!error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>
      <Modal visible={dangerAction!==null} transparent animationType="fade" onRequestClose={()=>setDangerAction(null)}>
        <Pressable style={styles.overlay} onPress={()=>setDangerAction(null)}><Pressable accessibilityRole="button" style={styles.confirmCard} onPress={()=>{}}>
          <Ionicons name={dangerAction==="delete"?"warning-outline":"pause-circle-outline"} size={26} color={colors.red}/>
          <Text style={styles.confirmTitle}>{dangerAction==="delete"?"Delete account":"Disable account"}</Text>
          <Text style={styles.confirmText}>{dangerAction==="delete"?"Your account will be scheduled for deletion in 30 days. Sign in before then to cancel.":"Your account and active sessions will be disabled. Signing in again reactivates it."}</Text>
          <Field label="Current password" value={dangerPassword} onChangeText={setDangerPassword} />
          <View style={styles.confirmActions}><Pressable accessibilityRole="button" style={styles.cancel} onPress={()=>setDangerAction(null)}><Text style={styles.cancelText}>Cancel</Text></Pressable><Pressable accessibilityRole="button" style={[styles.confirmDanger,(!dangerPassword||busy)&&styles.disabled]} disabled={!dangerPassword||busy} onPress={()=>void confirmDangerAction()}><Text style={styles.confirmDangerText}>{dangerAction==="delete"?"Delete":"Disable"}</Text></Pressable></View>
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
