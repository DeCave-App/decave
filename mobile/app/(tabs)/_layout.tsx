import { Redirect, Tabs } from "expo-router";
import { useSession } from "@/src/providers/SessionProvider";
import { LoungeShell } from "@/src/components/LoungeShell";
import { useTranslation } from "react-i18next";

export default function TabLayout() {
  const { t } = useTranslation(["common"]);
  const { user, loading } = useSession();

  if (loading) {
    return null;
  }

  if (!user) {
    return <Redirect href="/login" />;
  }

  // The Lounge shell draws the Hub strip and the left tab rail, so the
  // navigator's own tab bar is hidden.
  return (
    <LoungeShell>
      <Tabs
        tabBar={() => null}
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: "transparent" },
        }}
      >
        <Tabs.Screen name="home" options={{ title: t("common.rail.homeTitle") }} />
        <Tabs.Screen name="dms" options={{ title: t("common.rail.dms") }} />
        <Tabs.Screen name="hubs" options={{ title: "Hubs" }} />
        <Tabs.Screen name="friends" options={{ title: t("common.bottomBar.friends") }} />
        <Tabs.Screen name="squad-finder" options={{ title: t("common.rail.squad") }} />
        <Tabs.Screen name="profile" options={{ title: t("common.mobile.tabs.me") }} />
      </Tabs>
    </LoungeShell>
  );
}
