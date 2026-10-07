import { useState } from "react";
import {
  ActivityIndicator,
  Clipboard,
  Image,
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

const statusOptions: Array<{
  value: PresenceStatus;
  label: string;
  detail: string;
  icon: string;
  tone: "green" | "yellow" | "red" | "muted";
}> = [
  {
    value: "online",
    label: "Online",
    detail: "Available",
    icon: "ellipse",
    tone: "green",
  },
  {
    value: "idle",
    label: "Idle",
    detail: "Away for a bit",
    icon: "moon",
    tone: "yellow",
  },
  {
    value: "dnd",
    label: "Do Not Disturb",
    detail: "Minimize interruptions",
    icon: "remove-circle",
    tone: "red",
  },
  {
    value: "invisible",
    label: "Invisible",
    detail: "Appear offline",
    icon: "eye-off",
    tone: "muted",
  },
];

type EditablePresenceField = "statusText" | "displayName" | "pronouns"; // DECAVE_PARITY_PROFILE_INTERNAL

const editableFields: Record<
  EditablePresenceField,
  { title: string; placeholder: string; maxLength: number; icon: string }
> = {
  statusText: {
    title: "Custom status",
    placeholder: "What’s happening?",
    maxLength: 80,
    icon: "chatbubble-ellipses-outline",
  },
  displayName: {
    title: "Display name",
    placeholder: "How your name shows to others",
    maxLength: 32,
    icon: "person-outline",
  },
  pronouns: {
    title: "Pronouns",
    placeholder: "e.g. she/her, he/him, they/them",
    maxLength: 24,
    icon: "pricetag-outline",
  },
};

export default function ProfileScreen() {
  const { user, token, refreshUser, logout } = useSession();
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState("");
  const [editingField, setEditingField] =
    useState<EditablePresenceField | null>(null);
  const [editValue, setEditValue] = useState("");
  const [savingField, setSavingField] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [copied, setCopied] = useState(false);

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
          : "Could not update status.",
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

  const savePresenceField = async (nextValue = editValue) => {
    if (!token || !editingField || savingField) return;

    setSavingField(true);
    setNotice("");

    const field = editingField;
    const value = nextValue.trim().slice(0, editableFields[field].maxLength);
    const statusText = field === "statusText" ? value : user.statusText ?? "";
    const displayName = field === "displayName" ? value : user.displayName ?? "";
    const pronouns = field === "pronouns" ? value : user.pronouns ?? "";
    const activityText = user.activityText ?? "";

    try {
      await apiJson<{ user: AccountUser }>(
        "/api/profile",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bio: user.bio,
            status: user.status,
            statusText,
            activityText,
            accent: user.accent,
            displayName,
            pronouns,
          }),
        },
        token,
      );

      await refreshUser();
      setEditingField(null);
      setEditValue("");
      setNotice("Profile updated.");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Could not update profile.",
      );
    } finally {
      setSavingField(false);
    }
  };

  const editingConfig = editableFields[editingField ?? "statusText"];
  const editingTitle = editingConfig.title;
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
            <Text maxFontSizeMultiplier={1.3} style={styles.kicker}>YOUR ACCOUNT</Text>
            <Text style={styles.title}>Profile</Text>
          </View>
        </View>

        <View style={styles.profileCard}>
          <View style={styles.banner}>
            {bannerUri ? (
              <Image
                source={{ uri: bannerUri }}
                style={StyleSheet.absoluteFill}
                resizeMode="cover"
                accessibilityLabel="Profile banner"
              />
            ) : (
              <>
                <View style={styles.bannerViolet} />
                <View style={styles.bannerCyan} />
              </>
            )}
          </View>

          <View style={styles.profileTop}>
            <View style={styles.avatarWrap}>
              <View style={styles.avatarRing}>
                <Avatar
                  username={user.username}
                  avatarUrl={user.avatarUrl}
                  size={80}
                />
              </View>
              <View
                style={[styles.presenceBadge, { backgroundColor: presenceColor(currentStatus.tone) }]}
                accessibilityLabel={`Status: ${currentStatus.label}`}
              />
            </View>

            <Text style={styles.name} numberOfLines={1}>
              {shownName}
            </Text>
            <Text style={styles.handle} numberOfLines={1}>
              @{user.username}
              {user.pronouns?.trim() ? ` · ${user.pronouns.trim()}` : ""}
            </Text>
            {!!memberSince && (
              <Text style={styles.memberSince}>Member since {memberSince}</Text>
            )}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={user.statusText ? `Custom status: ${user.statusText}. Edit` : "Set a custom status"}
              style={({ pressed }) => [styles.customStatus, pressed && styles.statusPressed]}
              onPress={() => openEditor("statusText")}
            >
              <Ionicons name="chatbubble-ellipses-outline" size={15} color={user.statusText ? colors.cyan : colors.faint} />
              <Text style={[styles.customStatusText, !user.statusText && styles.customStatusPlaceholder]} numberOfLines={1}>
                {user.statusText || "Set a custom status…"}
              </Text>
              <Ionicons name="pencil" size={13} color={colors.faint} />
            </Pressable>

            <View style={styles.idRow}>
              <Text style={styles.idLabel}>ID</Text>
              <Text style={styles.id} selectable numberOfLines={1}>
                {user.id}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={copied ? "DeCave ID copied" : "Copy DeCave ID"}
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
            <Text style={styles.menuRowTitle}>Status</Text>
            <Text style={styles.menuRowValue} numberOfLines={1}>{currentStatus.label}</Text>
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
                  <Text style={[styles.statusText, active && styles.statusTextActive]}>{option.label}</Text>
                  <Text style={styles.statusDetail}>{option.detail}</Text>
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
            <Text style={[styles.menuRowTitle, { flex: 1 }]}>Settings</Text>
            <Ionicons name="chevron-forward" size={17} color={colors.faint} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={[styles.menuRow, styles.menuRowLast]}
            onPress={() => void logout()}
          >
            <Ionicons name="log-out-outline" size={17} color={colors.red} style={styles.menuRowIcon} />
            <Text style={[styles.menuRowTitle, { flex: 1, color: colors.red }]}>Log out</Text>
          </Pressable>
        </View>

        {!!notice && (
          <View
            style={[
              styles.notice,
              notice === "Profile updated." && styles.noticeSuccess,
            ]}
          >
            <Ionicons
              name={
                notice === "Profile updated."
                  ? "checkmark-circle-outline"
                  : "alert-circle-outline"
              }
              size={16}
              color={
                notice === "Profile updated."
                  ? colors.green
                  : colors.yellow
              }
            />
            <Text
              style={[
                styles.noticeText,
                notice === "Profile updated." &&
                  styles.noticeTextSuccess,
              ]}
            >
              {notice}
            </Text>
          </View>
        )}

        <SectionHeader label="PROFILE DETAILS" />

        <View style={styles.info}>
          <EditableInfo
            icon={editableFields.displayName.icon}
            label="Display name"
            value={user.displayName?.trim() || `Not set (shows ${user.username})`}
            onPress={() => openEditor("displayName")}
          />
          <EditableInfo
            icon={editableFields.pronouns.icon}
            label="Pronouns"
            value={user.pronouns?.trim() || "Not set"}
            onPress={() => openEditor("pronouns")}
            last
          />
        </View>
      </ScrollView>

      <Modal
        visible={editingField !== null}
        transparent
        animationType="fade"
        onRequestClose={closeEditor}
      >
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
                <Text maxFontSizeMultiplier={1.3} style={styles.modalKicker}>PROFILE</Text>
                <Text style={styles.modalTitle}>
                  Edit {editingTitle}
                </Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Close"
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
              style={styles.modalInput}
              returnKeyType="done"
              onSubmitEditing={() => void savePresenceField()}
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
                <Text style={styles.modalSecondaryText}>Clear</Text>
              </Pressable>

              <Pressable accessibilityRole="button"
                style={styles.modalSecondary}
                onPress={closeEditor}
                disabled={savingField}
              >
                <Text style={styles.modalSecondaryText}>Cancel</Text>
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
                    <Text style={styles.modalSaveText}>Save</Text>
                  </>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
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
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
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
  return (
    <Pressable
      style={[styles.infoRow, last && styles.infoRowLast]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Edit ${label}`}
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
    backgroundColor: colors.bg,
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
    backgroundColor: colors.panel,
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
    backgroundColor: colors.panel2,
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
