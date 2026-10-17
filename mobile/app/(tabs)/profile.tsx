import { useState } from "react";
import {
  ActivityIndicator,
  Clipboard,
  Image,
  KeyboardAvoidingView,
  Platform,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  RefreshControl,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Screen } from "@/src/components/Screen";
import { Avatar } from "@/src/components/Avatar";
import { absoluteMediaUrl, apiJson } from "@/src/lib/api";
import { useSession } from "@/src/providers/SessionProvider";
import { colors } from "@/src/theme";
import type { AccountUser, PresenceStatus } from "@/src/types";
import { useTranslation } from "react-i18next";
import { dateLocale } from "@/src/lib/date-locale";
import { ProfileMediaRows, useProfileMedia } from "@/src/components/profile/ProfileMedia";
import { AccentPicker } from "@/src/components/profile/AccentPicker";

// Labels come from statusCopy() in the screen, in the UI language.
const statusOptions: Array<{
  value: PresenceStatus;
  icon: string;
  tone: "green" | "yellow" | "red" | "muted";
}> = [
  {
    value: "online",
    icon: "ellipse",
    tone: "green",
  },
  {
    value: "idle",
    icon: "moon",
    tone: "yellow",
  },
  {
    value: "dnd",
    icon: "remove-circle",
    tone: "red",
  },
  {
    value: "invisible",
    icon: "eye-off",
    tone: "muted",
  },
];

type EditablePresenceField = "statusText" | "displayName" | "pronouns" | "bio"; // DECAVE_PARITY_PROFILE_INTERNAL
type ProfilePatch = Partial<Pick<AccountUser, "bio" | "statusText" | "displayName" | "pronouns" | "accent">>;

// Titles and placeholders come from fieldCopy in the screen, in the UI language.
const editableFields: Record<EditablePresenceField, { maxLength: number; icon: string }> = {
  statusText: {
    maxLength: 80,
    icon: "chatbubble-ellipses-outline",
  },
  displayName: {
    maxLength: 32,
    icon: "person-outline",
  },
  pronouns: {
    maxLength: 24,
    icon: "pricetag-outline",
  },
  // The Worker keeps the first 190 characters (PUT /api/profile).
  bio: {
    maxLength: 190,
    icon: "document-text-outline",
  },
};

export default function ProfileScreen() {
  const { t } = useTranslation(["settings", "common"]);
  const statusCopy: Record<PresenceStatus, { label: string; detail: string }> = {
    online: { label: t("common.presence.online"), detail: t("settings.mobile.profile.status.onlineDetail") },
    idle: { label: t("common.presence.idle"), detail: t("settings.mobile.profile.status.idleDetail") },
    dnd: { label: t("common.presence.dnd"), detail: t("settings.mobile.profile.status.dndDetail") },
    invisible: { label: t("common.presence.invisible"), detail: t("settings.mobile.profile.status.invisibleDetail") },
  };
  const fieldCopy: Record<EditablePresenceField, { title: string; placeholder: string; editTitle: string }> = {
    statusText: {
      title: t("settings.profile.customStatus"),
      placeholder: t("settings.mobile.profile.fields.statusTextPlaceholder"),
      editTitle: t("settings.mobile.profile.fields.statusTextEdit"),
    },
    displayName: {
      title: t("settings.profile.displayName"),
      placeholder: t("settings.mobile.profile.fields.displayNamePlaceholder"),
      editTitle: t("settings.mobile.profile.fields.displayNameEdit"),
    },
    pronouns: {
      title: t("settings.profile.pronouns"),
      placeholder: t("settings.mobile.profile.fields.pronounsPlaceholder"),
      editTitle: t("settings.mobile.profile.fields.pronounsEdit"),
    },
    bio: {
      title: t("settings.profile.bio"),
      placeholder: t("settings.mobile.profile.fields.bioPlaceholder"),
      editTitle: t("settings.mobile.profile.fields.bioEdit"),
    },
  };
  const { user, token, refreshUser, logout } = useSession();
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState("");
  const [editingField, setEditingField] =
    useState<EditablePresenceField | null>(null);
  const [editValue, setEditValue] = useState("");
  const [savingField, setSavingField] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [savingAccent, setSavingAccent] = useState(false);
  const media = useProfileMedia(
    token,
    async () => {
      await refreshUser();
      setNotice(t("settings.mobile.profile.profileUpdated"));
    },
    setNotice,
  );

  if (!user) return null;

  const updateStatus = async (status: PresenceStatus) => {
    if (!token) return;

    setNotice("");

    try {
      await apiJson<{ user: AccountUser }>(
        "/api/profile/status",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        },
        token,
      );

      await refreshUser();
      setStatusOpen(false);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : t("settings.mobile.profile.couldNotUpdateStatus"),
      );
    }
  };

  const openEditor = (field: EditablePresenceField) => {
    setNotice("");
    setEditingField(field);
    setEditValue((user[field] ?? "").slice(0, editableFields[field].maxLength));
  };

  const closeEditor = () => {
    if (savingField) return;
    setEditingField(null);
    setEditValue("");
  };

  // PUT /api/profile replaces every field it is sent, so each save sends the
  // current values with `patch` applied.
  const saveProfile = async (patch: ProfilePatch): Promise<boolean> => {
    if (!token) return false;
    setNotice("");
    try {
      await apiJson<{ user: AccountUser }>(
        "/api/profile",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bio: patch.bio ?? user.bio,
            status: user.status,
            statusText: patch.statusText ?? user.statusText ?? "",
            activityText: user.activityText ?? "",
            accent: patch.accent ?? user.accent,
            displayName: patch.displayName ?? user.displayName ?? "",
            pronouns: patch.pronouns ?? user.pronouns ?? "",
          }),
        },
        token,
      );

      await refreshUser();
      setNotice(t("settings.mobile.profile.profileUpdated"));
      return true;
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : t("settings.mobile.profile.couldNotUpdateProfile"),
      );
      return false;
    }
  };

  const savePresenceField = async (nextValue = editValue) => {
    if (!token || !editingField || savingField) return;

    setSavingField(true);
    const field = editingField;
    const value = nextValue.trim().slice(0, editableFields[field].maxLength);
    const saved = await saveProfile({ [field]: value });
    setSavingField(false);
    if (saved) {
      setEditingField(null);
      setEditValue("");
    }
  };

  const saveAccent = async (accent: string) => {
    if (savingAccent) return;
    setSavingAccent(true);
    await saveProfile({ accent });
    setSavingAccent(false);
  };

  const editingConfig = { ...editableFields[editingField ?? "statusText"], ...fieldCopy[editingField ?? "statusText"] };
  const editingPlaceholder =
    editingField === "displayName" ? user.username : editingConfig.placeholder;
  const bannerUri = absoluteMediaUrl(user.bannerUrl);
  const shownName = user.displayName?.trim() || user.username;

  const currentStatus =
    statusOptions.find((item) => item.value === user.status) ??
    statusOptions[0];
  const memberSince = formatMemberSince(user.createdAt);

  const copyId = () => {
    Clipboard.setString(user.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <Screen>
      <ScrollView keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.cyan} onRefresh={() => { setRefreshing(true); void refreshUser().finally(() => setRefreshing(false)); }} />}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headingRow}>
          <View style={{ flex: 1 }}>
            <Text maxFontSizeMultiplier={1.3} style={styles.kicker}>{t("settings.mobile.profile.yourAccount")}</Text>
            <Text style={styles.title}>{t("settings.profile.photoTitle")}</Text>
          </View>
        </View>

        <View style={styles.profileCard}>
          <Pressable
            style={styles.banner}
            onPress={() => void media.change("banner")}
            disabled={media.busy !== null}
            accessibilityRole="button"
            accessibilityLabel={bannerUri ? t("settings.profile.changeBanner") : t("settings.profile.addBanner")}
          >
            {bannerUri ? (
              <Image
                source={{ uri: bannerUri }}
                style={StyleSheet.absoluteFill}
                resizeMode="cover"
                accessibilityLabel={t("settings.mobile.profile.profileBanner")}
              />
            ) : (
              <>
                <View style={styles.bannerViolet} />
                <View style={styles.bannerCyan} />
              </>
            )}
            {media.busy === "banner" && (
              <View style={styles.mediaBusy}>
                <ActivityIndicator color="#fff" />
              </View>
            )}
          </Pressable>

          <View style={styles.profileTop}>
            <Pressable
              style={styles.avatarWrap}
              onPress={() => void media.change("avatar")}
              disabled={media.busy !== null}
              accessibilityRole="button"
              accessibilityLabel={t("settings.profile.changePhoto")}
            >
              {/* The profile accent colours the avatar ring, as on desktop. */}
              <View style={[styles.avatarRing, { backgroundColor: user.accent || colors.panel }]}>
                <Avatar
                  username={user.username}
                  avatarUrl={user.avatarUrl}
                  size={80}
                />
                {media.busy === "avatar" && (
                  <View style={styles.mediaBusy}>
                    <ActivityIndicator color="#fff" />
                  </View>
                )}
              </View>
              <View
                style={[styles.presenceBadge, { backgroundColor: presenceColor(currentStatus.tone) }]}
                accessibilityLabel={t("settings.mobile.profile.statusLabel", { label: statusCopy[currentStatus.value].label })}
              />
            </Pressable>

            <Text style={styles.name} numberOfLines={1}>
              {shownName}
            </Text>
            <Text style={styles.handle} numberOfLines={1}>
              @{user.username}
              {user.pronouns?.trim() ? ` · ${user.pronouns.trim()}` : ""}
            </Text>
            {!!memberSince && (
              <Text style={styles.memberSince}>{t("settings.mobile.profile.memberSinceMembersince", { memberSince })}</Text>
            )}
            {!!user.bio?.trim() && (
              <Text style={styles.bio} numberOfLines={6}>
                {user.bio.trim()}
              </Text>
            )}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={user.statusText ? t("settings.mobile.profile.customStatusStatustextEdit", { statusText: user.statusText }) : t("settings.mobile.profile.setACustomStatus")}
              style={({ pressed }) => [styles.customStatus, pressed && styles.statusPressed]}
              onPress={() => openEditor("statusText")}
            >
              <Ionicons name="chatbubble-ellipses-outline" size={15} color={user.statusText ? colors.cyan : colors.faint} />
              <Text style={[styles.customStatusText, !user.statusText && styles.customStatusPlaceholder]} numberOfLines={1}>
                {user.statusText || t("common.userMenu.setStatus")}
              </Text>
              <Ionicons name="pencil" size={13} color={colors.faint} />
            </Pressable>

            <View style={styles.idRow}>
              <Text style={styles.idLabel}>{t("settings.mobile.profile.id")}</Text>
              <Text style={styles.id} selectable numberOfLines={1}>
                {user.id}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={copied ? t("settings.mobile.profile.decaveIdCopied") : t("settings.account.copyDecaveId")}
                hitSlop={8}
                onPress={copyId}
              >
                <Ionicons name={copied ? "checkmark" : "copy-outline"} size={16} color={copied ? colors.green : colors.cyan} />
              </Pressable>
            </View>
          </View>
        </View>

        <View style={[styles.info, { marginTop: 14 }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: statusOpen }}
            style={[styles.menuRow, statusOpen && styles.menuRowOpen]}
            onPress={() => setStatusOpen((value) => !value)}
          >
            <Ionicons name={currentStatus.icon as any} size={15} color={presenceColor(currentStatus.tone)} style={styles.menuRowIcon} />
            <Text style={styles.menuRowTitle}>{t("settings.anchors.status.label")}</Text>
            <Text style={styles.menuRowValue} numberOfLines={1}>{statusCopy[currentStatus.value].label}</Text>
            <Ionicons name={statusOpen ? "chevron-up" : "chevron-down"} size={17} color={colors.faint} />
          </Pressable>
          {statusOpen && statusOptions.map((option) => {
            const active = user.status === option.value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="menuitem"
                accessibilityState={{ selected: active }}
                style={({ pressed }) => [styles.statusOption, pressed && styles.statusPressed]}
                onPress={() => void updateStatus(option.value)}
              >
                <View style={[styles.statusDot, { backgroundColor: presenceColor(option.tone) }]} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.statusText, active && styles.statusTextActive]}>{statusCopy[option.value].label}</Text>
                  <Text style={styles.statusDetail}>{statusCopy[option.value].detail}</Text>
                </View>
                {active && <Ionicons name="checkmark" size={17} color={colors.cyan} />}
              </Pressable>
            );
          })}
          <Pressable
            accessibilityRole="button"
            style={styles.menuRow}
            onPress={() => router.push("/settings")}
          >
            <Ionicons name="settings-outline" size={17} color={colors.cyan} style={styles.menuRowIcon} />
            <Text style={[styles.menuRowTitle, { flex: 1 }]}>{t("settings.window.title")}</Text>
            <Ionicons name="chevron-forward" size={17} color={colors.faint} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={[styles.menuRow, styles.menuRowLast]}
            onPress={() => void logout()}
          >
            <Ionicons name="log-out-outline" size={17} color={colors.red} style={styles.menuRowIcon} />
            <Text style={[styles.menuRowTitle, { flex: 1, color: colors.red }]}>{t("common.logout.confirm")}</Text>
          </Pressable>
        </View>

        {!!notice && (
          <View
            style={[
              styles.notice,
              notice === t("settings.mobile.profile.profileUpdated") && styles.noticeSuccess,
            ]}
          >
            <Ionicons
              name={
                notice === t("settings.mobile.profile.profileUpdated")
                  ? "checkmark-circle-outline"
                  : "alert-circle-outline"
              }
              size={16}
              color={
                notice === t("settings.mobile.profile.profileUpdated")
                  ? colors.green
                  : colors.yellow
              }
            />
            <Text
              style={[
                styles.noticeText,
                notice === t("settings.mobile.profile.profileUpdated") &&
                  styles.noticeTextSuccess,
              ]}
            >
              {notice}
            </Text>
          </View>
        )}

        <SectionHeader label={t("settings.mobile.profile.profileDetails")} />

        <View style={styles.info}>
          <ProfileMediaRows user={user} media={media} />
          <EditableInfo
            icon={editableFields.displayName.icon}
            label={t("settings.anchors.displayName.label")}
            value={user.displayName?.trim() || t("settings.mobile.profile.notSetShowsUsername", { username: user.username })}
            onPress={() => openEditor("displayName")}
          />
          <EditableInfo
            icon={editableFields.pronouns.icon}
            label={t("settings.profile.pronouns")}
            value={user.pronouns?.trim() || t("settings.mobile.profile.notSet")}
            onPress={() => openEditor("pronouns")}
          />
          <EditableInfo
            icon={editableFields.bio.icon}
            label={t("settings.profile.bio")}
            value={user.bio?.trim() || t("settings.mobile.profile.notSet")}
            onPress={() => openEditor("bio")}
          />
          <AccentPicker accent={user.accent} saving={savingAccent} onChange={(color) => void saveAccent(color)} />
        </View>
      </ScrollView>

      <Modal
        visible={editingField !== null}
        transparent
        animationType="fade"
        onRequestClose={closeEditor}
      >
        {/* The input autofocuses: lift the sheet above the keyboard. */}
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable style={styles.modalBackdrop} onPress={closeEditor}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <View style={styles.modalGrabber} />

            <View style={styles.modalHeading}>
              <View style={styles.modalHeadingIcon}>
                <Ionicons
                  name={editingConfig.icon as any}
                  size={21}
                  color={colors.cyan}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text maxFontSizeMultiplier={1.3} style={styles.modalKicker}>{t("settings.mobile.profile.profile")}</Text>
                <Text style={styles.modalTitle}>
                  {editingConfig.editTitle}
                </Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={t("common.actions.close")}
                style={styles.modalClose}
                onPress={closeEditor}
              >
                <Ionicons
                  name="close"
                  size={19}
                  color={colors.muted}
                />
              </Pressable>
            </View>

            <TextInput
              value={editValue}
              onChangeText={setEditValue}
              placeholder={editingPlaceholder}
              placeholderTextColor={colors.faint}
              maxLength={editingConfig.maxLength}
              autoCapitalize={editingField === "pronouns" ? "none" : "sentences"}
              autoFocus
              // The bio takes several lines; Return adds a line there instead of saving.
              multiline={editingField === "bio"}
              textAlignVertical={editingField === "bio" ? "top" : "center"}
              style={[styles.modalInput, editingField === "bio" && styles.modalInputMultiline]}
              returnKeyType={editingField === "bio" ? "default" : "done"}
              onSubmitEditing={editingField === "bio" ? undefined : () => void savePresenceField()}
            />

            <Text maxFontSizeMultiplier={1.3} style={styles.characterCount}>
              {editValue.length}/{editingConfig.maxLength}
            </Text>

            <View style={styles.modalActions}>
              <Pressable accessibilityRole="button"
                style={styles.modalSecondary}
                onPress={() => void savePresenceField("")}
                disabled={savingField}
              >
                <Text style={styles.modalSecondaryText}>{t("common.actions.clear")}</Text>
              </Pressable>

              <Pressable accessibilityRole="button"
                style={styles.modalSecondary}
                onPress={closeEditor}
                disabled={savingField}
              >
                <Text style={styles.modalSecondaryText}>{t("common.actions.cancel")}</Text>
              </Pressable>

              <Pressable accessibilityRole="button"
                style={[
                  styles.modalSave,
                  savingField && styles.modalSaveDisabled,
                ]}
                onPress={() => void savePresenceField()}
                disabled={savingField}
              >
                {savingField ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Ionicons
                      name="checkmark"
                      size={16}
                      color="#fff"
                    />
                    <Text style={styles.modalSaveText}>{t("common.actions.save")}</Text>
                  </>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}

function presenceColor(
  tone: "green" | "yellow" | "red" | "muted",
): string {
  if (tone === "green") return colors.green;
  if (tone === "yellow") return colors.yellow;
  if (tone === "red") return colors.red;
  return colors.faint;
}

function formatMemberSince(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(dateLocale(), { month: "short", day: "numeric", year: "numeric" });
}

function SectionHeader({ label }: { label: string }) {
  return (
    <View style={styles.sectionHeader} accessibilityRole="header">
      <Text maxFontSizeMultiplier={1.3} style={styles.section}>{label}</Text>
      <View style={styles.sectionRule} />
    </View>
  );
}

function EditableInfo({
  icon,
  label,
  value,
  onPress,
  last = false,
}: {
  icon: string;
  label: string;
  value: string;
  onPress: () => void;
  last?: boolean;
}) {
  const { t } = useTranslation(["settings"]);
  return (
    <Pressable
      style={[styles.infoRow, last && styles.infoRowLast]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t("settings.mobile.profile.editLabel", { label })}
    >
      <View style={styles.infoIcon}>
        <Ionicons
          name={icon as any}
          size={18}
          color={colors.cyan}
        />
      </View>

      <View style={styles.infoCopy}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue} numberOfLines={1}>
          {value}
        </Text>
      </View>

      <Ionicons
        name="chevron-forward"
        size={18}
        color={colors.faint}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 28,
  },
  headingRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 18,
  },
  kicker: {
    color: colors.cyan,
    fontSize: 12,
    letterSpacing: 2,
    fontWeight: "900",
  },
  title: {
    color: colors.text,
    fontSize: 32,
    lineHeight: 37,
    fontWeight: "900",
    marginTop: 3,
  },
  subtitle: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 4,
  },
  settingsButton: {
    width: 44,
    height: 44,
    borderRadius: 15,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },

  profileCard: {
    overflow: "hidden",
    padding: 14,
    paddingTop: 0,
    borderRadius: 21,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  banner: {
    height: 92,
    marginHorizontal: -14,
    overflow: "hidden",
    backgroundColor: "#3B1D7A",
  },
  bannerViolet: {
    position: "absolute",
    top: -90,
    left: -40,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: "rgba(168,85,247,0.75)",
  },
  bannerCyan: {
    position: "absolute",
    bottom: -110,
    right: -50,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: "rgba(34,211,238,0.55)",
  },
  profileTop: {
    marginTop: -44,
  },
  avatarWrap: {
    alignSelf: "flex-start",
    marginBottom: 8,
  },
  avatarRing: {
    padding: 3,
    borderRadius: 28,
    backgroundColor: colors.panel,
    overflow: "hidden",
  },
  presenceBadge: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 4,
    borderColor: colors.panel,
  },
  memberSince: {
    color: colors.faint,
    marginTop: 4,
    fontSize: 12,
  },
  bio: {
    color: colors.text,
    marginTop: 9,
    fontSize: 13,
    lineHeight: 18,
  },
  mediaBusy: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.overlay,
  },
  customStatus: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 11,
    borderRadius: 12,
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.border,
  },
  customStatusText: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
  },
  customStatusPlaceholder: {
    color: colors.faint,
    fontWeight: "600",
  },
  idRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
    paddingHorizontal: 2,
  },
  menuRow: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  menuRowOpen: {
    backgroundColor: colors.panel2,
  },
  menuRowLast: {
    borderBottomWidth: 0,
  },
  menuRowIcon: {
    width: 20,
    textAlign: "center",
  },
  menuRowTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
  },
  menuRowValue: {
    flex: 1,
    textAlign: "right",
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
  },
  statusOption: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingLeft: 20,
    paddingRight: 13,
    backgroundColor: colors.panel2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusDetail: {
    color: colors.faint,
    fontSize: 11,
    marginTop: 1,
  },
  profileCopy: {
    flex: 1,
    minWidth: 0,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  name: {
    flexShrink: 1,
    color: colors.text,
    fontSize: 21,
    fontWeight: "900",
  },
  presenceDot: {
    width: 8,
    height: 8,
    borderRadius: 99,
    backgroundColor: colors.green,
  },
  presenceYellow: {
    backgroundColor: colors.yellow,
  },
  presenceRed: {
    backgroundColor: colors.red,
  },
  presenceMuted: {
    backgroundColor: colors.faint,
  },
  handle: {
    color: colors.lilac,
    marginTop: 2,
    fontSize: 13,
    fontWeight: "700",
  },
  email: {
    color: colors.muted,
    marginTop: 3,
    fontSize: 12,
  },
  currentPresence: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 99,
    backgroundColor: colors.panel2,
  },
  currentPresenceText: {
    fontSize: 13,
    fontWeight: "900",
  },
  idCard: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginTop: 14,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.border,
  },
  idIcon: {
    width: 31,
    height: 31,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.cyanSoft,
  },
  idLabel: {
    color: colors.faint,
    fontSize: 10.5,
    fontWeight: "700",
    letterSpacing: 1.4,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  id: {
    flex: 1,
    color: colors.muted,
    fontSize: 12,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 23,
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  section: {
    color: colors.faint,
    fontSize: 10.5,
    letterSpacing: 1.6,
    fontWeight: "700",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  sectionRule: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  statusGrid: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  status: { width: "48.5%", minHeight: 42, flexDirection: "row", alignItems: "center", gap: 6, padding: 7, borderRadius: 13,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusActive: {
    backgroundColor: colors.cyanSoft,
    borderColor: "rgba(95,225,255,.30)",
  },
  statusPressed: {
    opacity: 0.76,
  },
  statusIcon: { width: 27, height: 27, borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.panel2,
  },
  statusIconActive: {
    backgroundColor: colors.solid,
  },
  statusText: { color: colors.text, fontWeight: "900", fontSize: 12,
  },
  statusTextActive: {
    color: colors.cyan,
  },

  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
  },
  noticeSuccess: {},
  noticeText: {
    flex: 1,
    color: colors.yellow,
    fontSize: 12,
  },
  noticeTextSuccess: {
    color: colors.green,
  },

  info: {
    borderRadius: 17,
    overflow: "hidden",
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
  },
  infoRow: {
    minHeight: 65,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  infoRowLast: {
    borderBottomWidth: 0,
  },
  infoIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.cyanSoft,
  },
  infoCopy: {
    flex: 1,
    minWidth: 0,
  },
  infoLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
  },
  infoValue: {
    color: colors.text,
    fontWeight: "800",
    fontSize: 13,
    marginTop: 3,
  },

  settingsRow: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderRadius: 17,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
  },
  settingsRowIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.cyanSoft,
  },
  settingsRowTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
  },
  settingsRowHelp: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 12,
    marginTop: 3,
  },
  logout: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    marginTop: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,102,120,.28)",
    backgroundColor: colors.redSoft,
  },
  logoutText: {
    color: colors.red,
    fontWeight: "900",
    fontSize: 12,
  },

  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: colors.overlay,
  },
  modalCard: {
    paddingHorizontal: 16,
    paddingTop: 9,
    paddingBottom: 20,
    borderTopLeftRadius: 27,
    borderTopRightRadius: 27,
    backgroundColor: colors.sheet2,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  modalGrabber: {
    width: 38,
    height: 4,
    alignSelf: "center",
    borderRadius: 99,
    backgroundColor: colors.faint,
    opacity: 0.5,
    marginBottom: 14,
  },
  modalHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  modalHeadingIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.cyanSoft,
  },
  modalKicker: {
    color: colors.cyan,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.7,
  },
  modalTitle: {
    color: colors.text,
    fontSize: 19,
    fontWeight: "900",
    marginTop: 2,
  },
  modalClose: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.sheet,
  },
  modalInput: {
    minHeight: 48,
    marginTop: 15,
    backgroundColor: colors.input,
    color: colors.text,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 13,
    paddingVertical: 11,
    fontSize: 13,
  },
  modalInputMultiline: {
    minHeight: 104,
    maxHeight: 180,
    paddingTop: 11,
  },
  characterCount: {
    color: colors.faint,
    textAlign: "right",
    fontSize: 11,
    marginTop: 6,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 7,
    marginTop: 13,
  },
  modalSecondary: {
    minWidth: 65,
    minHeight: 40,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 11,
  },
  modalSecondaryText: {
    color: colors.muted,
    fontWeight: "800",
    fontSize: 12,
  },
  modalSave: {
    minWidth: 76,
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    borderRadius: 11,
    backgroundColor: colors.violet,
    paddingHorizontal: 13,
  },
  modalSaveDisabled: {
    opacity: 0.6,
  },
  modalSaveText: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 12,
  },});
