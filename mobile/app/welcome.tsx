// First-run welcome for accounts with no Hubs: create a Hub, join a public one, or just chat.
// Home opens it once per account (src/lib/hub-welcome.ts). Same choices as the web's HubOnboardingScreen.

import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { Screen } from "@/src/components/Screen";
import { colors, radii, spacing } from "@/src/theme";

type Choice = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  href: Href;
  primary?: boolean;
};

export default function WelcomeScreen() {
  const { t } = useTranslation(["hub", "common"]);

  const choices: Choice[] = [
    {
      icon: "add-circle-outline",
      title: t("hub.onboarding.createTitle"),
      // The phone Create sheet has no templates or Discord import, unlike the web one.
      body: t("hub.onboarding.createBodyMobile"),
      href: { pathname: "/hubs", params: { create: "1" } },
      primary: true,
    },
    {
      icon: "compass-outline",
      title: t("hub.onboarding.discoverTitle"),
      body: t("hub.onboarding.discoverBody"),
      href: { pathname: "/hubs", params: { mode: "discover" } },
    },
    {
      icon: "people-outline",
      title: t("hub.onboarding.friendsTitle"),
      body: t("hub.onboarding.friendsBody"),
      href: "/home",
    },
  ];

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.brand}>
          <Image source={require("../assets/decave-mark.png")} style={styles.mark} />
          <Text style={styles.brandText}>DeCave</Text>
        </View>

        <Text style={styles.title}>{t("hub.onboarding.title")}</Text>
        <Text style={styles.lead}>{t("hub.onboarding.lead")}</Text>

        <View style={styles.choices}>
          {choices.map((choice) => (
            <Pressable
              key={choice.title}
              accessibilityRole="button"
              accessibilityLabel={`${choice.title}. ${choice.body}`}
              style={({ pressed }) => [
                styles.choice,
                choice.primary && styles.choicePrimary,
                pressed && styles.choicePressed,
              ]}
              onPress={() => router.replace(choice.href)}
            >
              <View style={styles.choiceIcon}>
                <Ionicons name={choice.icon} size={22} color={colors.cyan} />
              </View>
              <View style={styles.choiceText}>
                <Text style={styles.choiceTitle}>{choice.title}</Text>
                <Text style={styles.choiceBody}>{choice.body}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </Pressable>
          ))}
        </View>

        <View style={styles.explainer}>
          <Ionicons name="lock-closed-outline" size={14} color={colors.muted} />
          <Text style={styles.explainerText}>{t("hub.onboarding.explainer")}</Text>
        </View>

        <Pressable accessibilityRole="button" style={styles.skip} onPress={() => router.replace("/home")}>
          <Text style={styles.skipText}>{t("hub.onboarding.skip")}</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, justifyContent: "center", padding: spacing.xl },
  brand: { flexDirection: "row", alignItems: "center", alignSelf: "center", marginBottom: 22 },
  mark: { width: 60, height: 60, resizeMode: "contain" },
  brandText: { color: colors.text, fontSize: 28, fontWeight: "900", marginLeft: 10 },
  title: { color: colors.text, fontSize: 28, fontWeight: "900", textAlign: "center" },
  lead: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 21,
    textAlign: "center",
    marginTop: 8,
    marginBottom: 22,
  },
  choices: { gap: spacing.sm },
  choice: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
  },
  choicePrimary: { borderColor: colors.violet, backgroundColor: colors.violetSoft },
  choicePressed: { opacity: 0.75 },
  choiceIcon: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.cyanSoft,
  },
  choiceText: { flex: 1, minWidth: 0 },
  choiceTitle: { color: colors.text, fontSize: 16, fontWeight: "900" },
  choiceBody: { color: colors.muted, fontSize: 13, lineHeight: 18, marginTop: 3 },
  explainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 20,
  },
  explainerText: { color: colors.muted, fontSize: 12 },
  skip: { alignSelf: "center", marginTop: 10, paddingHorizontal: 14, paddingVertical: 10 },
  skipText: { color: colors.muted, fontSize: 14, fontWeight: "700", textDecorationLine: "underline" },
});
