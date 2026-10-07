import { Redirect, Tabs } from "expo-router";
import { useSession } from "@/src/providers/SessionProvider";
import { LoungeShell } from "@/src/components/LoungeShell";

export default function TabLayout() {
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
        <Tabs.Screen name="home" options={{ title: "Home" }} />
        <Tabs.Screen name="dms" options={{ title: "DMs" }} />
        <Tabs.Screen name="hubs" options={{ title: "Hubs" }} />
        <Tabs.Screen name="friends" options={{ title: "Friends" }} />
        <Tabs.Screen name="squad-finder" options={{ title: "Squad" }} />
        <Tabs.Screen name="profile" options={{ title: "Me" }} />
      </Tabs>
    </LoungeShell>
  );
}
