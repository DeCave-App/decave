// Sheet for managing a Hub (name, icon, banner, members, invites).

import type { Hub } from "@/src/types";
import { Modal, View, Pressable, Text, ScrollView, TextInput, ActivityIndicator } from "react-native";
import { styles } from "./hubScreen.styles";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/src/theme";

export function ManageHubSheet({
  visible,
  hub,
  isOwner,
  name,
  description,
  category,
  visibility,
  busy,
  error,
  onName,
  onDescription,
  onCategory,
  onVisibility,
  onClose,
  onSave,
  onCreateRoom,
}: {
  visible: boolean;
  hub: Hub;
  isOwner: boolean;
  name: string;
  description: string;
  category: string;
  visibility: "private" | "public";
  busy: boolean;
  error: string;
  onName: (value: string) => void;
  onDescription: (value: string) => void;
  onCategory: (value: string) => void;
  onVisibility: (value: "private" | "public") => void;
  onClose: () => void;
  onSave: () => void;
  onCreateRoom: () => void;
}) {
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
              <Text maxFontSizeMultiplier={1.3} style={styles.sheetKicker}>HUB MANAGEMENT</Text>
              <Text style={styles.sheetTitle}>Manage {hub.name}</Text>
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
            <Text style={styles.fieldLabel}>Hub name</Text>
            <TextInput
              value={name}
              onChangeText={onName}
              maxLength={40}
              placeholder="Hub name"
              placeholderTextColor={colors.faint}
              style={styles.input}
            />

            <Text style={styles.fieldLabel}>Description</Text>
            <TextInput
              value={description}
              onChangeText={onDescription}
              maxLength={300}
              multiline
              placeholder="What is this Hub about?"
              placeholderTextColor={colors.faint}
              style={[styles.input, styles.multiline]}
            />

            <Text style={styles.fieldLabel}>Category</Text>
            <TextInput
              value={category}
              onChangeText={onCategory}
              maxLength={40}
              placeholder="Gaming"
              placeholderTextColor={colors.faint}
              style={styles.input}
            />

            <View style={styles.permissionCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.permissionTitle}>Hub visibility</Text>
                <Text style={styles.permissionText}>
                  {isOwner
                    ? "Only the Hub owner can change public/private visibility."
                    : `This Hub is ${hub.visibility}. Visibility can only be changed by the owner.`}
                </Text>
              </View>
            </View>

            {isOwner && (
              <View style={styles.segment}>
                {(["private", "public"] as const).map((value) => {
                  const active = visibility === value;
                  return (
                    <Pressable accessibilityRole="button"
                      key={value}
                      style={[
                        styles.segmentButton,
                        active && styles.segmentButtonActive,
                      ]}
                      onPress={() => onVisibility(value)}
                    >
                      <Ionicons
                        name={value === "private" ? "lock-closed" : "globe-outline"}
                        size={15}
                        color={active ? colors.cyan : colors.muted}
                      />
                      <Text
                        style={[
                          styles.segmentText,
                          active && styles.segmentTextActive,
                        ]}
                      >
                        {value === "private" ? "Private" : "Public"}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}

            <Text style={styles.sheetSectionTitle}>ROOMS</Text>
            <Pressable accessibilityRole="button" style={styles.createRoomCard} onPress={onCreateRoom}>
              <View style={styles.createRoomIcon}>
                <Ionicons name="add" size={21} color={colors.cyan} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.createRoomTitle}>Create a new room</Text>
                <Text style={styles.createRoomText}>
                  Add another Text Room or Voice Room to this Hub.
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </Pressable>

            {!!error && <Text style={styles.formError}>{error}</Text>}

            <Pressable accessibilityRole="button"
              style={[styles.primaryButton, busy && styles.buttonDisabled]}
              disabled={busy}
              onPress={onSave}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>Save Hub changes</Text>
              )}
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
