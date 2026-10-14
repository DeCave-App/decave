// Profile photo and banner: change (pick + crop + upload) and remove, as rows
// on the profile screen. The hook is shared with the profile card so tapping
// the avatar or banner there opens the same picker.

import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { pickProfileImage, removeProfileImage, uploadProfileImage, type ProfileImageKind } from "@/src/lib/profile-media";
import { colors } from "@/src/theme";
import type { AccountUser } from "@/src/types";
import { styles } from "./profile.styles";

export type ProfileMediaControls = {
  busy: ProfileImageKind | null;
  change: (kind: ProfileImageKind) => Promise<void>;
  remove: (kind: ProfileImageKind) => Promise<void>;
};

/** Picks/uploads/removes the avatar or banner; `onSaved` refreshes the account, `onError` shows a message ("" clears it). */
export function useProfileMedia(
  token: string | null | undefined,
  onSaved: () => Promise<void>,
  onError: (message: string) => void,
): ProfileMediaControls {
  const { t } = useTranslation(["chat", "errors"]);
  const [busy, setBusy] = useState<ProfileImageKind | null>(null);

  const change = async (kind: ProfileImageKind) => {
    if (!token || busy) return;
    onError("");
    let dataUrl: string | null;
    try {
      dataUrl = await pickProfileImage(kind);
    } catch (error) {
      onError(error instanceof Error ? error.message : t("chat.actions.profile.readImageFailed"));
      return;
    }
    if (!dataUrl) return;
    setBusy(kind);
    try {
      await uploadProfileImage(kind, dataUrl, token);
      await onSaved();
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : kind === "avatar"
            ? t("chat.actions.profile.uploadAvatarFailed")
            : t("chat.actions.profile.uploadBannerFailed"),
      );
    } finally {
      setBusy(null);
    }
  };

  const remove = async (kind: ProfileImageKind) => {
    if (!token || busy) return;
    onError("");
    setBusy(kind);
    try {
      await removeProfileImage(kind, token);
      await onSaved();
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : kind === "avatar"
            ? t("errors.client.profile.removeAvatar")
            : t("errors.client.profile.removeBanner"),
      );
    } finally {
      setBusy(null);
    }
  };

  return { busy, change, remove };
}

/** The "Change photo" and "Change banner" rows, each with Remove when one is set. */
export function ProfileMediaRows({ user, media }: { user: AccountUser; media: ProfileMediaControls }) {
  return (
    <>
      <MediaRow kind="avatar" hasImage={!!user.avatarUrl} media={media} />
      <MediaRow kind="banner" hasImage={!!user.bannerUrl} media={media} />
    </>
  );
}

function MediaRow({ kind, hasImage, media }: { kind: ProfileImageKind; hasImage: boolean; media: ProfileMediaControls }) {
  const { t } = useTranslation(["settings"]);
  const title =
    kind === "avatar"
      ? t("settings.profile.changePhoto")
      : hasImage
        ? t("settings.profile.changeBanner")
        : t("settings.profile.addBanner");
  const busy = media.busy === kind;
  return (
    <View style={styles.row}>
      <Pressable
        style={({ pressed }) => [styles.rowMain, pressed && styles.rowPressed]}
        onPress={() => void media.change(kind)}
        disabled={media.busy !== null}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ busy, disabled: media.busy !== null }}
      >
        <View style={styles.rowIcon}>
          <Ionicons name={kind === "avatar" ? "person-circle-outline" : "image-outline"} size={19} color={colors.cyan} />
        </View>
        <View style={styles.rowCopy}>
          <Text style={styles.rowTitle}>{busy ? t("settings.profile.saving") : title}</Text>
          <Text style={styles.rowHelp}>
            {kind === "avatar" ? t("settings.profile.photoHelp") : t("settings.profile.bannerHelp")}
          </Text>
        </View>
      </Pressable>
      {busy ? (
        <ActivityIndicator color={colors.cyan} />
      ) : hasImage ? (
        <Pressable
          style={({ pressed }) => [styles.remove, pressed && styles.rowPressed]}
          onPress={() => void media.remove(kind)}
          disabled={media.busy !== null}
          accessibilityRole="button"
          accessibilityLabel={`${t("settings.profile.remove")} · ${title}`}
          hitSlop={6}
        >
          <Text style={styles.removeText}>{t("settings.profile.remove")}</Text>
        </Pressable>
      ) : (
        <Ionicons name="chevron-forward" size={18} color={colors.faint} />
      )}
    </View>
  );
}
