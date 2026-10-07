import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Screen } from "@/src/components/Screen";
import { apiJson } from "@/src/lib/api";
import { useSession } from "@/src/providers/SessionProvider";
import { colors } from "@/src/theme";

function parseQr(value: string): { challengeId: string; secret: string } | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "decave:" || url.hostname !== "qr-login") return null;
    const challengeId = url.searchParams.get("challenge") ?? "";
    const secret = url.searchParams.get("secret") ?? "";
    return challengeId && secret ? { challengeId, secret } : null;
  } catch { return null; }
}

export default function ScanLoginScreen() {
  const { token } = useSession();
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [challenge, setChallenge] = useState<{ challengeId: string; secret: string } | null>(null);
  const [preview, setPreview] = useState<{ deviceLabel: string; locationLabel: string; expiresAt: string } | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [error, setError] = useState("");

  const handleScan = async ({ data }: { data: string }) => {
    if (busy || scanned || !token) return;
    const parsed = parseQr(data);
    if (!parsed) {
      setScanned(true);
      setError("Not a DeCave login code. Scan the QR code shown on the DeCave web or desktop login screen.");
      return;
    }
    setScanned(true);
    setBusy(true);
    try {
      const data = await apiJson<{ deviceLabel: string; locationLabel: string; expiresAt: string }>("/api/auth/qr/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      }, token);
      setChallenge(parsed);
      setPreview(data);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not inspect this login. Refresh the QR code and try again.");
      setScanned(false);
    } finally { setBusy(false); }
  };

  const approve = async () => {
    if (!token || !challenge || busy) return;
    setBusy(true); setError("");
    try {
      await apiJson("/api/auth/qr/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...challenge, approved: true, ...(mfaCode.trim() ? { mfaCode: mfaCode.trim() } : {}) }),
      }, token);
      setError("Login approved. The other device is now signed in.");
      setChallenge(null); setPreview(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not approve this login.");
    } finally { setBusy(false); }
  };

  const cancelPreview = () => { setChallenge(null); setPreview(null); setMfaCode(""); setError(""); setScanned(false); };

  return <Screen><View style={styles.top}><Pressable accessibilityRole="button" accessibilityLabel="Back" style={styles.back} onPress={() => router.back()}><Ionicons name="chevron-back" size={22} color={colors.cyan} /></Pressable><View><Text maxFontSizeMultiplier={1.3} style={styles.kicker}>SECURE LOGIN</Text><Text style={styles.title}>Scan QR code</Text></View></View><View style={styles.body}>
    {!permission ? <ActivityIndicator color={colors.cyan} /> : !permission.granted ? <View style={styles.permission}><Ionicons name="camera-outline" size={38} color={colors.cyan} /><Text style={styles.permissionTitle}>Camera access is required</Text><Text style={styles.help}>DeCave only uses the camera here to scan a one-time login code.</Text><Pressable accessibilityRole="button" style={styles.primary} onPress={() => void requestPermission()}><Text style={styles.primaryText}>Allow camera</Text></Pressable></View> : preview ? <View style={styles.preview}><Ionicons name="shield-checkmark-outline" size={36} color={colors.cyan} /><Text style={styles.permissionTitle}>Approve this sign-in?</Text><Text style={styles.help}>Only approve if you started this login on a device you control.</Text><Text style={styles.previewLabel}>Requesting device</Text><Text style={styles.previewValue}>{preview.deviceLabel}</Text><Text style={styles.previewLabel}>Approximate location</Text><Text style={styles.previewValue}>{preview.locationLabel}</Text><Text style={styles.help}>Expires {new Date(preview.expiresAt).toLocaleString()}</Text><TextInput value={mfaCode} onChangeText={setMfaCode} placeholder="Authenticator or recovery code (if requested)" placeholderTextColor={colors.faint} autoCapitalize="characters" autoComplete="one-time-code" style={styles.input} /><Pressable accessibilityRole="button" style={[styles.primary,busy&&styles.disabled]} disabled={busy} onPress={() => void approve()}><Text style={styles.primaryText}>{busy ? "Approving…" : "Approve sign-in"}</Text></Pressable><Pressable accessibilityRole="button" style={styles.secondary} onPress={cancelPreview}><Text style={styles.secondaryText}>Cancel</Text></Pressable></View> : <><View style={styles.cameraWrap}><CameraView style={styles.camera} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={scanned ? undefined : handleScan} /><View style={styles.frame} /></View><Text style={styles.help}>Point the camera at the QR code on the web or desktop login screen. Codes expire after two minutes.</Text>{busy && <ActivityIndicator color={colors.cyan} />}</>}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
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
  disabled: { opacity: 0.6 }, error: { color: colors.red, fontSize: 12, lineHeight: 17, textAlign: "center", paddingHorizontal: 18 },
  permission: { alignItems: "center", gap: 12 }, permissionTitle: { color: colors.text, fontSize: 17, fontWeight: "900" },
  primary: { marginTop: 5, minHeight: 44, paddingHorizontal: 22, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.violet }, primaryText: { color: "#fff", fontSize: 13, fontWeight: "900" },
});
