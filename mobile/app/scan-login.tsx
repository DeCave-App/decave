import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Screen } from "@/src/components/Screen";
import { apiJson } from "@/src/lib/api";
import { useSession } from "@/src/providers/SessionProvider";
import { colors } from "@/src/theme";
import { useTranslation } from "react-i18next";
import { i18next } from "@/src/i18n";
import { countryText, deviceName } from "@/src/lib/session-device";

function parseQr(value: string): { challengeId: string; secret: string } | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "decave:" || url.hostname !== "qr-login") return null;
    const challengeId = url.searchParams.get("challenge") ?? "";
    const secret = url.searchParams.get("secret") ?? "";
    return challengeId && secret ? { challengeId, secret } : null;
  } catch { return null; }
}

type QrPreview = { deviceLabel: string; device?: unknown; locationLabel: string; locationCountry?: unknown; expiresAt: string; mfaRequired?: boolean };

/** The requesting device in the UI language; the Worker's English label from older servers. */
function previewDeviceText(preview: QrPreview): string {
  if (preview.device === null && preview.deviceLabel === "Unknown device") return i18next.t("settings.sessions.unknownDevice");
  return deviceName(preview.deviceLabel, preview.device);
}

/** The approximate location in the UI language; the Worker's English label from older servers. */
function locationText(preview: QrPreview): string {
  if (preview.locationCountry === null) return i18next.t("auth.mobile.scanLogin.unknownLocation");
  const country = countryText(preview.locationCountry);
  return country && country !== preview.locationCountry ? country : preview.locationLabel;
}

export default function ScanLoginScreen() {
  const { t } = useTranslation(["auth", "common"]);
  const { token } = useSession();
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [scanned, setScanned] = useState(false);
  // After a scan, show who is asking and wait for an explicit approve.
  const [challenge, setChallenge] = useState<{ challengeId: string; secret: string } | null>(null);
  const [preview, setPreview] = useState<QrPreview | null>(null);
  const [mfaCode, setMfaCode] = useState("");

  const handleScan = async ({ data }: { data: string }) => {
    if (busy || scanned || !token) return;
    const parsed = parseQr(data);
    if (!parsed) {
      setScanned(true);
      Alert.alert(
        t("auth.mobile.scanLogin.notADecaveLoginCode"),
        t("auth.mobile.scanLogin.scanTheQrCodeShown"),
        [{ text: t("auth.mobile.scanLogin.scanAgain"), onPress: () => setScanned(false) }],
      );
      return;
    }
    setScanned(true);
    setBusy(true);
    try {
      const data = await apiJson<QrPreview>("/api/auth/qr/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      }, token);
      setChallenge(parsed);
      setPreview(data);
      setMfaCode("");
    } catch (cause) {
      Alert.alert(t("auth.mobile.scanLogin.couldNotCheckThisLogin"), cause instanceof Error ? cause.message : t("auth.mobile.scanLogin.refreshTheQrCodeAnd"), [{ text: t("auth.mobile.scanLogin.tryAgain"), onPress: () => setScanned(false) }]);
    } finally { setBusy(false); }
  };

  const cancelPreview = () => { setChallenge(null); setPreview(null); setMfaCode(""); setScanned(false); };

  const approve = async () => {
    if (!token || !challenge || !preview || busy) return;
    const code = mfaCode.trim();
    if (preview.mfaRequired && !code) {
      Alert.alert(t("auth.mobile.scanLogin.codeRequired"), t("auth.mobile.scanLogin.enterACodeFromYour"));
      return;
    }
    setBusy(true);
    try {
      await apiJson("/api/auth/qr/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...challenge, approved: true, ...(code ? { mfaCode: code } : {}) }),
      }, token);
      setChallenge(null); setPreview(null); setMfaCode("");
      Alert.alert(t("auth.mobile.scanLogin.loginApproved"), t("auth.mobile.scanLogin.theOtherDeviceIsNow"), [{ text: t("common.actions.done"), onPress: () => router.back() }]);
    } catch (cause) {
      Alert.alert(t("auth.mobile.scanLogin.couldNotApproveLogin"), cause instanceof Error ? cause.message : t("auth.mobile.scanLogin.refreshTheQrCodeAnd"));
    } finally { setBusy(false); }
  };

  return <Screen><View style={styles.top}><Pressable accessibilityRole="button" accessibilityLabel={t("common.actions.back")} style={styles.back} onPress={() => router.back()}><Ionicons name="chevron-back" size={22} color={colors.cyan} /></Pressable><View><Text maxFontSizeMultiplier={1.3} style={styles.kicker}>{t("auth.mobile.scanLogin.secureLogin")}</Text><Text style={styles.title}>{t("auth.mobile.scanLogin.scanQrCode")}</Text></View></View><View style={styles.body}>
    {!permission ? <ActivityIndicator color={colors.cyan} /> : !permission.granted ? <View style={styles.permission}><Ionicons name="camera-outline" size={38} color={colors.cyan} /><Text style={styles.permissionTitle}>{t("auth.mobile.scanLogin.cameraAccessIsRequired")}</Text><Text style={styles.help}>{t("auth.mobile.scanLogin.decaveOnlyUsesTheCamera")}</Text><Pressable accessibilityRole="button" style={styles.primary} onPress={() => void requestPermission()}><Text style={styles.primaryText}>{t("auth.mobile.scanLogin.allowCamera")}</Text></Pressable></View> : preview ? <View style={styles.preview}><Ionicons name="shield-checkmark-outline" size={36} color={colors.cyan} /><Text style={styles.permissionTitle}>{t("auth.mobile.scanLogin.approveThisSignIn")}</Text><Text style={styles.help}>{t("auth.mobile.scanLogin.onlyApproveIfYouStarted")}</Text><Text style={styles.previewLabel}>{t("auth.mobile.scanLogin.requestingDevice")}</Text><Text style={styles.previewValue}>{previewDeviceText(preview)}</Text><Text style={styles.previewLabel}>{t("auth.mobile.scanLogin.approximateLocation")}</Text><Text style={styles.previewValue}>{locationText(preview)}</Text>{preview.mfaRequired && <TextInput value={mfaCode} onChangeText={setMfaCode} placeholder={t("common.account.mfaCodeLabel")} placeholderTextColor={colors.faint} autoCapitalize="characters" autoCorrect={false} autoComplete="one-time-code" textContentType="oneTimeCode" accessibilityLabel={t("common.account.mfaCodeLabel")} style={styles.input} />}<Pressable accessibilityRole="button" style={[styles.primary, busy && styles.disabled]} disabled={busy} onPress={() => void approve()}><Text style={styles.primaryText}>{busy ? t("auth.mobile.scanLogin.approving") : t("auth.mobile.scanLogin.approveSignIn")}</Text></Pressable><Pressable accessibilityRole="button" style={styles.secondary} disabled={busy} onPress={cancelPreview}><Text style={styles.secondaryText}>{t("common.actions.cancel")}</Text></Pressable></View> : <><View style={styles.cameraWrap}><CameraView style={styles.camera} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={scanned ? undefined : handleScan} /><View style={styles.frame} /></View><Text style={styles.help}>{t("auth.mobile.scanLogin.pointTheCameraAtThe")}</Text>{busy && <ActivityIndicator color={colors.cyan} />}</>}
  </View></Screen>;
}

const styles = StyleSheet.create({
  top: { minHeight: 76, flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  back: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border },
  kicker: { color: colors.cyan, fontSize: 11, fontWeight: "900", letterSpacing: 1.6 }, title: { color: colors.text, fontSize: 21, fontWeight: "900" },
  body: { flex: 1, alignItems: "center", justifyContent: "center", gap: 18, padding: 18 },
  cameraWrap: { width: "100%", maxWidth: 430, aspectRatio: 1, borderRadius: 24, overflow: "hidden", borderWidth: 1, borderColor: colors.borderStrong }, camera: { flex: 1 },
  frame: { position: "absolute", left: "14%", top: "14%", right: "14%", bottom: "14%", borderWidth: 3, borderColor: colors.cyan, borderRadius: 22 },
  help: { color: colors.muted, fontSize: 12, lineHeight: 16, textAlign: "center", maxWidth: 390 },
  preview: { width: "100%", maxWidth: 390, alignItems: "center", gap: 10, padding: 18, borderRadius: 18, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border },
  previewLabel: { alignSelf: "stretch", color: colors.faint, fontSize: 11, fontWeight: "800", textTransform: "uppercase" },
  previewValue: { alignSelf: "stretch", color: colors.text, fontSize: 15, fontWeight: "800" },
  input: { alignSelf: "stretch", minHeight: 44, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.input, borderRadius: 12, color: colors.text, paddingHorizontal: 12 },
  secondary: { minHeight: 40, paddingHorizontal: 20, justifyContent: "center" }, secondaryText: { color: colors.cyan, fontWeight: "800" },
  disabled: { opacity: 0.6 },
  permission: { alignItems: "center", gap: 12 }, permissionTitle: { color: colors.text, fontSize: 17, fontWeight: "900" },
  primary: { marginTop: 5, minHeight: 44, paddingHorizontal: 22, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.violet }, primaryText: { color: "#fff", fontSize: 13, fontWeight: "900" },
});
