// Sheet for creating and editing a room.

import type { Channel, ForumPostPolicy } from "@/src/types";
import { type RoomType, type HubMember, ROOM_ICON_CHOICES } from "./hubShared";
import { useState, useMemo } from "react";
import { Modal, View, Pressable, Text, ScrollView, TextInput, Switch, ActivityIndicator } from "react-native";
import { styles } from "./hubScreen.styles";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { colors } from "@/src/theme";
import { Avatar } from "@/src/components/Avatar";
import { ROOM_ACCENT_SWATCHES } from "../../../../shared/room-style";

export function RoomEditorSheet({
  visible,
  editing,
  name,
  type,
  icon,
  guidelines,
  postPolicy,
  accent,
  canMoveUp,
  canMoveDown,
  isPrivate,
  memberIds,
  members,
  membersLoading,
  busy,
  error,
  onName,
  onType,
  onIcon,
  onGuidelines,
  onPostPolicy,
  onAccent,
  onMove,
  onPrivate,
  onToggleMember,
  onClose,
  onSave,
  onDelete,
}: {
  visible: boolean;
  editing: Channel | null;
  name: string;
  type: RoomType;
  icon: string;
  guidelines: string;
  postPolicy: ForumPostPolicy;
  accent: string | null;
  canMoveUp: boolean;
  canMoveDown: boolean;
  isPrivate: boolean;
  memberIds: string[];
  members: HubMember[];
  membersLoading: boolean;
  busy: boolean;
  error: string;
  onName: (value: string) => void;
  onType: (value: RoomType) => void;
  onIcon: (value: string) => void;
  onGuidelines: (value: string) => void;
  onPostPolicy: (value: ForumPostPolicy) => void;
  onAccent: (value: string | null) => void;
  onMove: (direction: -1 | 1) => void;
  onPrivate: (value: boolean) => void;
  onToggleMember: (userId: string) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation(["common", "hub"]);
  const [memberQuery, setMemberQuery] = useState("");
  const visibleMembers = useMemo(() => {
    const query = memberQuery.trim().toLowerCase();
    return query ? members.filter((member) => member.username.toLowerCase().includes(query)) : members;
  }, [memberQuery, members]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />

          <View style={styles.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Text maxFontSizeMultiplier={1.3} style={styles.sheetKicker}>
                {editing ? t("hub.mobile.roomEditor.kickerEdit") : t("hub.mobile.roomEditor.kickerNew")}
              </Text>
              <Text style={styles.sheetTitle}>
                {editing ? t("hub.mobile.rooms.edit", { name: editing.name }) : t("hub.mobile.roomEditor.titleNew")}
              </Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={t("common.actions.close")} style={styles.sheetClose} onPress={onClose}>
              <Ionicons name="close" size={20} color={colors.text} />
            </Pressable>
          </View>

          <ScrollView keyboardDismissMode="on-drag"
            contentContainerStyle={styles.sheetScroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {!editing && (
              <>
                <Text style={styles.fieldLabel}>{t("hub.roomSettings.type.label")}</Text>
                <View style={styles.segment}>
                  {(["text", "voice", "forum"] as const).map((value) => {
                    const active = type === value;
                    return (
                      <Pressable accessibilityRole="button"
                        key={value}
                        style={[
                          styles.segmentButton,
                          active && styles.segmentButtonActive,
                        ]}
                        onPress={() => onType(value)}
                      >
                        <Ionicons
                          name={
                            value === "text"
                              ? "chatbubble-ellipses-outline"
                              : value === "voice"
                                ? "volume-high-outline"
                                : "albums-outline"
                          }
                          size={16}
                          color={active ? colors.cyan : colors.muted}
                        />
                        <Text
                          style={[
                            styles.segmentText,
                            active && styles.segmentTextActive,
                          ]}
                        >
                          {t(`hub.roomSettings.type.${value}.label`)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}

            <Text style={styles.fieldLabel}>{t("hub.roomSettings.name")}</Text>
            <TextInput
              value={name}
              onChangeText={onName}
              maxLength={48}
              placeholder={t(`hub.mobile.roomEditor.placeholder.${type}`)}
              placeholderTextColor={colors.faint}
              style={styles.input}
            />

            <Text style={styles.fieldLabel}>{t("hub.mobile.roomEditor.icon")}</Text>
            <View style={styles.iconGrid}>
              <Pressable
                style={[styles.iconChoice, !icon && styles.iconChoiceActive]}
                onPress={() => onIcon("")}
                accessibilityRole="button"
                accessibilityLabel={t("hub.mobile.roomEditor.noIcon")}
                accessibilityState={{ selected: !icon }}
              >
                <Ionicons name="remove-outline" size={18} color={colors.muted} />
              </Pressable>
              {ROOM_ICON_CHOICES.map((choice) => (
                <Pressable
                  key={choice}
                  style={[styles.iconChoice, icon === choice && styles.iconChoiceActive]}
                  onPress={() => onIcon(choice)}
                  accessibilityRole="button"
                  accessibilityLabel={t("hub.mobile.roomEditor.useIcon", { icon: choice })}
                  accessibilityState={{ selected: icon === choice }}
                >
                  <Text style={styles.iconChoiceText}>{choice}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              value={icon}
              onChangeText={(value) => onIcon(Array.from(value.replace(/\s/g, "")).slice(0, 4).join(""))}
              placeholder={t("hub.mobile.roomEditor.emojiPlaceholder")}
              placeholderTextColor={colors.faint}
              style={[styles.input, styles.iconInput]}
              autoCorrect={false}
            />

            {editing && (
              <>
                <Text style={styles.fieldLabel}>{t("hub.roomSettings.style.accent")}</Text>
                <View style={styles.iconGrid}>
                  <Pressable
                    style={[styles.iconChoice, !accent && styles.iconChoiceActive]}
                    onPress={() => onAccent(null)}
                    accessibilityRole="button"
                    accessibilityLabel={t("hub.mobile.roomEditor.hubAccent")}
                    accessibilityState={{ selected: !accent }}
                  >
                    <Ionicons name="color-palette-outline" size={18} color={colors.muted} />
                  </Pressable>
                  {ROOM_ACCENT_SWATCHES.map((swatch) => (
                    <Pressable
                      key={swatch.color}
                      style={[
                        styles.iconChoice,
                        { backgroundColor: swatch.color, borderColor: swatch.color },
                        accent === swatch.color && { borderColor: colors.text, borderWidth: 2 },
                      ]}
                      onPress={() => onAccent(swatch.color)}
                      accessibilityRole="button"
                      accessibilityLabel={t("hub.mobile.roomEditor.swatchAccent", { color: t(`hub.roomSettings.style.swatches.${swatch.label.toLowerCase()}`, { defaultValue: swatch.label }) })}
                      accessibilityState={{ selected: accent === swatch.color }}
                    />
                  ))}
                </View>
              </>
            )}

            {type === "forum" && (
              <>
                <Text style={styles.fieldLabel}>{t("hub.mobile.roomEditor.guidelines")}</Text>
                <TextInput
                  value={guidelines}
                  onChangeText={onGuidelines}
                  maxLength={500}
                  multiline
                  placeholder={t("hub.mobile.roomEditor.guidelinesPlaceholder")}
                  placeholderTextColor={colors.faint}
                  style={[styles.input, styles.multilineInput]}
                />

                <Text style={styles.fieldLabel}>{t("hub.mobile.roomEditor.postPolicy")}</Text>
                <View style={styles.segment}>
                  {(["everyone", "staff"] as const).map((value) => {
                    const active = postPolicy === value;
                    return (
                      <Pressable accessibilityRole="button"
                        key={value}
                        style={[styles.segmentButton, active && styles.segmentButtonActive]}
                        onPress={() => onPostPolicy(value)}
                      >
                        <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                          {value === "everyone" ? t("hub.mobile.roomEditor.policyEveryone") : t("hub.mobile.roomEditor.policyStaff")}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {(postPolicy === "roles" || postPolicy === "members") && (
                  <Text style={styles.toggleText}>
                    {postPolicy === "roles" ? t("hub.mobile.roomEditor.policyLimitedRoles") : t("hub.mobile.roomEditor.policyLimitedMembers")}
                  </Text>
                )}
              </>
            )}

            <View style={styles.toggleCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.toggleTitle}>{t("hub.sidebar.privateRoom")}</Text>
                <Text style={styles.toggleText}>
                  {t("hub.mobile.roomEditor.privateHint")}
                </Text>
              </View>
              <Switch
                value={isPrivate}
                onValueChange={onPrivate}
                trackColor={{ false: "#263148", true: colors.violet }}
                thumbColor="#eef4ff"
              />
            </View>

            {isPrivate && (
              <>
                <View style={styles.memberHeader}>
                  <Text style={styles.sheetSectionTitle}>{t("hub.mobile.roomEditor.access")}</Text>
                  <Text maxFontSizeMultiplier={1.3} style={styles.memberCount}>
                    {t("hub.mobile.roomEditor.selected", { count: memberIds.length })}
                  </Text>
                </View>

                <View style={styles.memberSearch}>
                  <Ionicons name="search-outline" size={16} color={colors.muted} />
                  <TextInput
                    value={memberQuery}
                    onChangeText={setMemberQuery}
                    placeholder={t("hub.roomSettings.access.search")}
                    placeholderTextColor={colors.faint}
                    style={styles.memberSearchInput}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  {!!memberQuery && <Pressable accessibilityRole="button" accessibilityLabel={t("common.actions.clear")} onPress={() => setMemberQuery("")}><Ionicons name="close-circle" size={17} color={colors.faint} /></Pressable>}
                </View>

                {membersLoading ? (
                  <View style={styles.memberLoading}>
                    <ActivityIndicator color={colors.cyan} />
                  </View>
                ) : members.length === 0 ? (
                  <View style={styles.emptyMembers}>
                    <Text style={styles.emptyMembersTitle}>
                      {t("hub.mobile.roomEditor.noMembers")}
                    </Text>
                    <Text style={styles.emptyMembersText}>
                      {t("hub.mobile.roomEditor.noMembersHint")}
                    </Text>
                  </View>
                ) : visibleMembers.length === 0 ? (
                  <View style={styles.emptyMembers}><Text style={styles.emptyMembersTitle}>{t("hub.mobile.roomEditor.noMatch")}</Text><Text style={styles.emptyMembersText}>{t("hub.mobile.roomEditor.noMatchHint")}</Text></View>
                ) : (
                  <View style={styles.memberList}>
                    {visibleMembers.map((member) => {
                      const selected = memberIds.includes(member.userId);
                      return (
                        <Pressable accessibilityRole="button"
                          key={member.userId}
                          style={[
                            styles.memberRow,
                            selected && styles.memberRowSelected,
                          ]}
                          onPress={() => onToggleMember(member.userId)}
                        >
                          <Avatar
                            username={member.username}
                            avatarUrl={member.avatarUrl ?? null}
                            size={34}
                          />
                          <Text style={styles.memberName} numberOfLines={1}>
                            {member.username}
                          </Text>
                          <View
                            style={[
                              styles.memberCheck,
                              selected && styles.memberCheckSelected,
                            ]}
                          >
                            {selected && (
                              <Ionicons name="checkmark" size={15} color="#fff" />
                            )}
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </>
            )}

            {!!error && <Text style={styles.formError}>{error}</Text>}

            <Pressable accessibilityRole="button"
              style={[styles.primaryButton, busy && styles.buttonDisabled]}
              disabled={busy}
              onPress={onSave}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {editing ? t("hub.mobile.roomEditor.save") : t("hub.mobile.roomEditor.create")}
                </Text>
              )}
            </Pressable>

            {editing && (canMoveUp || canMoveDown) && (
              <View style={styles.segment}>
                <Pressable accessibilityRole="button"
                  style={[styles.segmentButton, (!canMoveUp || busy) && styles.buttonDisabled]}
                  disabled={!canMoveUp || busy}
                  onPress={() => onMove(-1)}
                >
                  <Ionicons name="arrow-up" size={16} color={colors.muted} />
                  <Text style={styles.segmentText}>{t("hub.hubHome.moveUp")}</Text>
                </Pressable>
                <Pressable accessibilityRole="button"
                  style={[styles.segmentButton, (!canMoveDown || busy) && styles.buttonDisabled]}
                  disabled={!canMoveDown || busy}
                  onPress={() => onMove(1)}
                >
                  <Ionicons name="arrow-down" size={16} color={colors.muted} />
                  <Text style={styles.segmentText}>{t("hub.hubHome.moveDown")}</Text>
                </Pressable>
              </View>
            )}

            {editing && (
              <Pressable accessibilityRole="button"
                style={[styles.dangerButton, busy && styles.buttonDisabled]}
                disabled={busy}
                onPress={onDelete}
              >
                <Ionicons name="trash-outline" size={17} color={colors.red} />
                <Text style={styles.dangerButtonText}>{t("hub.roomSettings.delete.action")}</Text>
              </Pressable>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
