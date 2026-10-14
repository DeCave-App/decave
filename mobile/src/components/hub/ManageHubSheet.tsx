// Sheet for managing a Hub (name, icon, banner, members, invites).

import type { Hub } from "@/src/types";
import { Modal, View, Pressable, Text, ScrollView, TextInput, ActivityIndicator } from "react-native";
import { ModalKeyboardAvoider } from "@/src/components/KeyboardAware";
import { styles } from "./hubScreen.styles";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation(["common", "hub"]);
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <ModalKeyboardAvoider>
      <View style={styles.modalOverlay}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />

          <View style={styles.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Text maxFontSizeMultiplier={1.3} style={styles.sheetKicker}>{t("hub.mobile.manage.kicker")}</Text>
              <Text style={styles.sheetTitle}>{t("hub.mobile.manage.title", { name: hub.name })}</Text>
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
            <Text style={styles.fieldLabel}>{t("hub.manageHub.profile.name")}</Text>
            <TextInput
              value={name}
              onChangeText={onName}
              maxLength={40}
              placeholder={t("hub.manageHub.profile.name")}
              placeholderTextColor={colors.faint}
              style={styles.input}
            />

            <Text style={styles.fieldLabel}>{t("hub.manageHub.profile.description")}</Text>
            <TextInput
              value={description}
              onChangeText={onDescription}
              maxLength={300}
              multiline
              placeholder={t("hub.manageHub.profile.descriptionPlaceholder")}
              placeholderTextColor={colors.faint}
              style={[styles.input, styles.multiline]}
            />

            <Text style={styles.fieldLabel}>{t("hub.manageHub.profile.category")}</Text>
            <TextInput
              value={category}
              onChangeText={onCategory}
              maxLength={40}
              placeholder={t("hub.onboarding.defaultCategory")}
              placeholderTextColor={colors.faint}
              style={styles.input}
            />

            <View style={styles.permissionCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.permissionTitle}>{t("hub.manageHub.visibility.label")}</Text>
                <Text style={styles.permissionText}>
                  {isOwner
                    ? t("hub.mobile.manage.visibilityOwner")
                    : t(hub.visibility === "public" ? "hub.mobile.manage.visibilityPublic" : "hub.mobile.manage.visibilityPrivate")}
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
                        {value === "private" ? t("hub.manageHub.visibility.private") : t("hub.manageHub.visibility.public")}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}

            <Text style={styles.sheetSectionTitle}>{t("hub.mobile.manage.rooms")}</Text>
            <Pressable accessibilityRole="button" style={styles.createRoomCard} onPress={onCreateRoom}>
              <View style={styles.createRoomIcon}>
                <Ionicons name="add" size={21} color={colors.cyan} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.createRoomTitle}>{t("hub.mobile.manage.createRoom")}</Text>
                <Text style={styles.createRoomText}>
                  {t("hub.mobile.manage.createRoomHint")}
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
                <Text style={styles.primaryButtonText}>{t("hub.mobile.manage.save")}</Text>
              )}
            </Pressable>
          </ScrollView>
        </View>
      </View>
      </ModalKeyboardAvoider>
    </Modal>
  );
}
