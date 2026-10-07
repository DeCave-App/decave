import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { API_BASE } from "@/src/lib/api";
import { colors } from "@/src/theme";

type Action = "login" | "register" | "forgot";

const BACKGROUND_GRACE_MS = 8000;

export function TurnstileModal({
  visible,
  action,
  onToken,
  onCancel,
}: {
  visible: boolean;
  action: Action;
  onToken: (token: string) => void;
  onCancel: () => void;
}) {
  const [showChallenge, setShowChallenge] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const uri = useMemo(
    () =>
      `${API_BASE}/mobile/turnstile?action=${encodeURIComponent(action)}&nonce=${Date.now()}-${attempt}`,
    [action, visible, attempt],
  );

  useEffect(() => {
    if (!visible) {
      setShowChallenge(false);
      return;
    }

    // Run Turnstile out of sight first. A visible challenge is only shown
    // after a generous grace period or when Cloudflare explicitly reports
    // that the background attempt needs recovery.
    setShowChallenge(false);
    const timer = setTimeout(() => {
      setShowChallenge(true);
    }, BACKGROUND_GRACE_MS);

    return () => clearTimeout(timer);
  }, [visible, action, attempt]);

  const onMessage = (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data) as {
        type?: string;
        token?: string;
        message?: string;
      };

      if (data.type === "turnstile-success" && data.token) {
        setShowChallenge(false);
        onToken(data.token);
        return;
      }

      if (
        data.type === "turnstile-error" ||
        data.type === "turnstile-expired"
      ) {
        setShowChallenge(true);
      }
    } catch {}
  };

  const retry = () => {
    setShowChallenge(false);
    setAttempt((current) => current + 1);
  };

  if (!visible) return null;

  return (
    <View
      pointerEvents={showChallenge ? "auto" : "none"}
      accessibilityElementsHidden={!showChallenge}
      importantForAccessibility={showChallenge ? "auto" : "no-hide-descendants"}
      style={showChallenge ? styles.challengeHost : styles.backgroundHost}
    >
      {showChallenge && (
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <Text maxFontSizeMultiplier={1.3} style={styles.kicker}>DECAVE SECURITY</Text>
            <Text style={styles.title}>One more check</Text>
            <Text style={styles.subtitle}>
              Cloudflare needs a quick interaction to finish verification.
            </Text>
          </View>

          <Pressable accessibilityRole="button" onPress={onCancel} hitSlop={12}>
            <Text style={styles.close}>Cancel</Text>
          </Pressable>
        </View>
      )}

      <WebView
        key={`${action}-${attempt}`}
        source={{ uri }}
        style={showChallenge ? styles.web : styles.backgroundWeb}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        // Turnstile loads about:blank / about:srcdoc frames; the default
        // whitelist (http/https only) blocks them and the widget never finishes.
        originWhitelist={["https://*", "http://*", "about:*"]}
        startInLoadingState={showChallenge}
        renderLoading={
          showChallenge
            ? () => (
                <View style={styles.loading}>
                  <ActivityIndicator color={colors.cyan} />
                  <Text style={styles.loadingText}>
                    Finishing security verification…
                  </Text>
                </View>
              )
            : undefined
        }
        onMessage={onMessage}
        onError={() => setShowChallenge(true)}
        onHttpError={() => setShowChallenge(true)}
      />

      {showChallenge && (
        <View style={styles.footer}>
          <Pressable accessibilityRole="button" style={styles.retry} onPress={retry}>
            <Text style={styles.retryText}>Retry in background</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  backgroundHost: {
    position: "absolute",
    left: -10000,
    top: -10000,
    width: 360,
    height: 220,
    opacity: 0.01,
  },
  backgroundWeb: {
    width: 360,
    height: 220,
    backgroundColor: "transparent",
  },
  challengeHost: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 999,
    elevation: 999,
    backgroundColor: colors.bg,
  },
  head: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  kicker: {
    color: colors.cyan,
    fontSize: 12,
    letterSpacing: 2,
    fontWeight: "800",
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800",
    marginTop: 3,
  },
  subtitle: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 16,
    marginTop: 4,
  },
  close: {
    color: colors.cyan,
    fontWeight: "700",
  },
  web: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  loading: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  loadingText: {
    color: colors.muted,
    marginTop: 10,
  },
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  retry: {
    minHeight: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
  },
  retryText: {
    color: colors.cyan,
    fontWeight: "800",
    fontSize: 12,
  },
});
