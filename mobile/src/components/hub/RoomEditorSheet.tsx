// Sheet for creating and editing a room.

import type { Channel, ForumPostPolicy } from "@/src/types";
import { type RoomType, type HubMember, ROOM_ICON_CHOICES } from "./hubShared";
import { useState, useMemo } from "react";
import { Modal, View, Pressable, Text, ScrollView, TextInput, Switch, ActivityIndicator } from "react-native";
import { styles } from "./hubScreen.styles";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/src/theme";
import { Avatar } from "@/src/components/Avatar";

export function RoomEditorSheet({
  visible,
  editing,
  name,
  type,
  icon,
  guidelines,
  postPolicy,
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
  onMove: (direction: -1 | 1) => void;
  onPrivate: (value: boolean) => void;
  onToggleMember: (userId: string) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
}) {
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
                {editing ? "ROOM SETTINGS" : "NEW ROOM"}
              </Text>
              <Text style={styles.sheetTitle}>
                {editing ? `Edit ${editing.name}` : "Create a room"}
              </Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" style={styles.sheetClose} onPress={onClose}>
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
                <Text style={styles.fieldLabel}>Room type</Text>
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
                          {value === "text" ? "Text" : value === "voice" ? "Voice" : "Forum"}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}

            <Text style={styles.fieldLabel}>Room name</Text>
            <TextInput
              value={name}
              onChangeText={onName}
              maxLength={48}
              placeholder={type === "voice" ? "Gaming Voice" : type === "forum" ? "guides" : "general"}
              placeholderTextColor={colors.faint}
              style={styles.input}
            />

            <Text style={styles.fieldLabel}>Room icon</Text>
            <View style={styles.iconGrid}>
              <Pressable
                style={[styles.iconChoice, !icon && styles.iconChoiceActive]}
                onPress={() => onIcon("")}
                accessibilityRole="button"
                accessibilityLabel="No icon"
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
                  accessibilityLabel={`Use ${choice} as room icon`}
                  accessibilityState={{ selected: icon === choice }}
                >
                  <Text style={styles.iconChoiceText}>{choice}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              value={icon}
              onChangeText={(value) => onIcon(Array.from(value.replace(/\s/g, "")).slice(0, 4).join(""))}
              placeholder="Or type any emoji"
              placeholderTextColor={colors.faint}
              style={[styles.input, styles.iconInput]}
              autoCorrect={false}
            />

            {type === "forum" && (
              <>
                <Text style={styles.fieldLabel}>Forum guidelines</Text>
                <TextInput
                  value={guidelines}
                  onChangeText={onGuidelines}
                  maxLength={500}
                  multiline
                  placeholder="What should people post here?"
                  placeholderTextColor={colors.faint}
                  style={[styles.input, styles.multilineInput]}
                />

                <Text style={styles.fieldLabel}>Who can start posts</Text>
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
                          {value === "everyone" ? "Everyone" : "Owner & admins"}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {(postPolicy === "roles" || postPolicy === "members") && (
                  <Text style={styles.toggleText}>
                    Posting is limited to selected {postPolicy === "roles" ? "roles" : "members"}. That list is kept as-is; pick an option above to replace it.
                  </Text>
                )}
              </>
            )}

            <View style={styles.toggleCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.toggleTitle}>Private room</Text>
                <Text style={styles.toggleText}>
                  Owner and admins always have access. Choose which regular Hub
                  members can enter below.
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
                  <Text style={styles.sheetSectionTitle}>ROOM ACCESS</Text>
                  <Text maxFontSizeMultiplier={1.3} style={styles.memberCount}>
                    {memberIds.length} selected
                  </Text>
                </View>

                <View style={styles.memberSearch}>
                  <Ionicons name="search-outline" size={16} color={colors.muted} />
                  <TextInput
                    value={memberQuery}
                    onChangeText={setMemberQuery}
                    placeholder="Search members"
                    placeholderTextColor={colors.faint}
                    style={styles.memberSearchInput}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  {!!memberQuery && <Pressable accessibilityRole="button" accessibilityLabel="Clear" onPress={() => setMemberQuery("")}><Ionicons name="close-circle" size={17} color={colors.faint} /></Pressable>}
                </View>

                {membersLoading ? (
                  <View style={styles.memberLoading}>
                    <ActivityIndicator color={colors.cyan} />
                  </View>
                ) : members.length === 0 ? (
                  <View style={styles.emptyMembers}>
                    <Text style={styles.emptyMembersTitle}>
                      No regular members to select
                    </Text>
                    <Text style={styles.emptyMembersText}>
                      The room will still be accessible to the Hub owner and admins.
                    </Text>
                  </View>
                ) : visibleMembers.length === 0 ? (
                  <View style={styles.emptyMembers}><Text style={styles.emptyMembersTitle}>No matching members</Text><Text style={styles.emptyMembersText}>Try a different username.</Text></View>
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
                  {editing ? "Save room" : "Create room"}
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
                  <Text style={styles.segmentText}>Move up</Text>
                </Pressable>
                <Pressable accessibilityRole="button"
                  style={[styles.segmentButton, (!canMoveDown || busy) && styles.buttonDisabled]}
                  disabled={!canMoveDown || busy}
                  onPress={() => onMove(1)}
                >
                  <Ionicons name="arrow-down" size={16} color={colors.muted} />
                  <Text style={styles.segmentText}>Move down</Text>
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
                <Text style={styles.dangerButtonText}>Delete room</Text>
              </Pressable>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
