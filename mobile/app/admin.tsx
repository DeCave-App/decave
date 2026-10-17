import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Screen } from "@/src/components/Screen";
import { createAdminApi, isPlatformOwner, ownerReauth, type OwnerReauth } from "@/src/lib/admin-api";
import { AccountsTab, AuditTab, GamesTab, OverviewTab, SafetyTab, SecurityTab, UnlockCard } from "@/src/components/admin/AdminTabs";
import { useSession } from "@/src/providers/SessionProvider";
import { colors } from "@/src/theme";

type Tab = "overview" | "trustSafety" | "accounts" | "security" | "audit" | "games";
const TABS: Tab[] = ["overview", "trustSafety", "accounts", "security", "audit", "games"];

/** Platform owner Admin & Security on the phone (owner sessions only), like web's admin page. */
export default function AdminScreen() {
  const { t } = useTranslation(["common", "chat"]);
  const { token } = useSession();
  const [owner, setOwner] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [reauth, setReauth] = useState<OwnerReauth>(null);
  const [now, setNow] = useState(() => Date.now());
  const api = useMemo(() => (token ? createAdminApi(token, reauth) : null), [token, reauth]);
  const unlocked = !!reauth && reauth.expiresAt > now;

  useEffect(() => {
    if (!token) return;
    void isPlatformOwner(token).then(setOwner);
  }, [token]);
  // Relock in the UI when the 10-minute unlock runs out.
  useEffect(() => {
    if (!reauth) return;
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [reauth]);

  return (
    <Screen>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("common.actions.back")} style={styles.back} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color={colors.cyan} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>{t("common.admin.kicker")}</Text>
          <Text style={styles.title}>{t("common.admin.title")}</Text>
        </View>
      </View>
      {owner === null ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.cyan} />
      ) : !owner || !api ? (
        <Text style={styles.denied}>{t("chat.actions.admin.ownerRequired")}</Text>
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.tabs}>
            {TABS.map((id) => (
              <Pressable key={id} accessibilityRole="tab" accessibilityState={{ selected: tab === id }} style={[styles.tab, tab === id && styles.tabOn]} onPress={() => setTab(id)}>
                <Text style={[styles.tabText, tab === id && styles.tabTextOn]}>{t(`common.admin.tabs.${id}`)}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <Text style={styles.lead}>{t("common.admin.lead")}</Text>
            {(tab === "trustSafety" || tab === "accounts" || tab === "overview") && (
              <UnlockCard
                reauth={unlocked ? reauth : null}
                onUnlock={async (password, code) => {
                  if (!token) return t("chat.actions.admin.unlockFirst");
                  try {
                    setReauth(await ownerReauth(token, password, code));
                    setNow(Date.now());
                    return null;
                  } catch (cause) {
                    return cause instanceof Error ? cause.message : t("chat.actions.admin.unlockFirst");
                  }
                }}
              />
            )}
            {tab === "overview" && <OverviewTab api={api} />}
            {tab === "trustSafety" && <SafetyTab api={api} unlocked={unlocked} />}
            {tab === "accounts" && <AccountsTab api={api} unlocked={unlocked} />}
            {tab === "security" && <SecurityTab api={api} />}
            {tab === "audit" && <AuditTab api={api} />}
            {tab === "games" && <GamesTab api={api} />}
          </ScrollView>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, paddingBottom: 8 },
  back: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border },
  kicker: { color: colors.cyan, fontSize: 11, fontWeight: "900", letterSpacing: 1.1 },
  title: { color: colors.text, fontSize: 19, fontWeight: "900", marginTop: 2 },
  denied: { margin: 24, color: colors.muted, fontSize: 14, textAlign: "center" },
  tabs: { gap: 6, paddingHorizontal: 14, paddingBottom: 8 },
  tab: { paddingHorizontal: 12, height: 34, justifyContent: "center", borderRadius: 10, backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border },
  tabOn: { backgroundColor: colors.cyanSoft, borderColor: colors.cyan },
  tabText: { color: colors.muted, fontSize: 13, fontWeight: "800" },
  tabTextOn: { color: colors.cyan },
  scroll: { padding: 14, paddingBottom: 40, gap: 12 },
  lead: { color: colors.muted, fontSize: 13, lineHeight: 18 },
});
