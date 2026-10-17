import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FORUM_LFG_LIMITS, FORUM_POLL_LIMITS, FORUM_POST_TYPES, FORUM_TAG_LIMITS } from "../../../../shared/forum";
import { encodeForumPost, FORUM_TYPE_ICONS } from "@/src/lib/forum-api";
import {
  buildForumPayload,
  EMPTY_FORUM_DRAFT,
  FORUM_COMPOSE_BODY_MAX,
  FORUM_COMPOSE_MAX_TAGS,
  FORUM_COMPOSE_TITLE_MAX,
  forumDraftError,
  LFG_PLATFORMS,
  LFG_STARTS,
  POLL_DURATIONS,
  toggleDraftTag,
  type ForumDraft,
} from "@/src/lib/forum-compose";
import { pickMedia, uploadAsset } from "@/src/lib/chat-media";
import { MessageImage } from "@/src/components/MessageMedia";
import { colors } from "@/src/theme";

type UploadKind = "cover" | "image" | "media";

/** Create a forum post of any type, like web's ForumComposeModal. `onPublish` sends the message text. */
export function ForumComposeSheet({
  visible,
  roomId,
  roomName,
  roomTags,
  token,
  canLockReplies,
  restriction,
  onClose,
  onPublish,
}: {
  visible: boolean;
  roomId: number;
  roomName: string;
  roomTags: string[];
  token: string | null;
  canLockReplies: boolean;
  /** Shown above the form when the room limits who can start posts. */
  restriction: string | null;
  onClose: () => void;
  onPublish: (text: string) => boolean;
}) {
  const { t } = useTranslation(["forum", "common", "chat"]);
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<ForumDraft>(EMPTY_FORUM_DRAFT);
  const [tagDraft, setTagDraft] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [uploading, setUploading] = useState<UploadKind | "">("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!visible) return;
    setSubmitted(false);
    setError("");
  }, [visible]);

  const set = <K extends keyof ForumDraft>(key: K, value: ForumDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const problem = forumDraftError(draft);
  const { type } = draft;

  const upload = async (kind: UploadKind) => {
    if (!token || uploading) return;
    try {
      const asset = await pickMedia("library");
      if (!asset) return;
      if (kind !== "media" && asset.type === "video") throw new Error(t("forum.compose.errors.imageType"));
      setUploading(kind);
      const result = await uploadAsset({ kind: "channel", channelId: roomId }, asset, token);
      if (kind === "cover") set("iconUrl", result.url);
      else if (kind === "media") setDraft((current) => ({ ...current, mediaUrl: result.url, mediaMime: (result.mimeType || "").slice(0, 100) }));
      else {
        const alt = (asset.fileName || t("forum.compose.placeholder.image")).replace(/[[\]()]/g, "").slice(0, 40);
        setDraft((current) => ({ ...current, body: `${current.body}${current.body && !current.body.endsWith("\n") ? "\n" : ""}![${alt}](${result.url})\n` }));
      }
    } catch (cause) {
      Alert.alert(t("forum.compose.errors.upload"), cause instanceof Error ? cause.message : t("forum.compose.errors.upload"));
    } finally {
      setUploading("");
    }
  };

  const addFreeTag = () => {
    if (!tagDraft.trim()) return;
    setDraft((current) => ({ ...current, tags: toggleDraftTag(current.tags, tagDraft) }));
    setTagDraft("");
  };

  const publish = () => {
    setSubmitted(true);
    if (problem || uploading) return;
    setError("");
    const text = encodeForumPost(buildForumPayload(draft, Date.now(), { canLockReplies }));
    if (!onPublish(text)) {
      setError(t("forum.view.reconnecting"));
      return;
    }
    setDraft(EMPTY_FORUM_DRAFT);
    setTagDraft("");
    onClose();
  };

  const tagChoices = roomTags.length ? roomTags : draft.tags;
  const titlePlaceholder =
    type === "question" ? t("forum.compose.titlePlaceholder.question") : type === "lfg" ? t("forum.compose.titlePlaceholder.lfg") : t("forum.compose.titlePlaceholder.default");

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("forum.compose.close")} hitSlop={8} onPress={onClose}>
            <Text style={styles.headerAction}>{t("common.actions.cancel")}</Text>
          </Pressable>
          <View style={{ flex: 1, alignItems: "center" }}>
            <Text maxFontSizeMultiplier={1.3} style={styles.kicker} numberOfLines={1}>{t("forum.compose.kicker", { room: roomName })}</Text>
            <Text style={styles.headerTitle} accessibilityRole="header">{t("forum.compose.title")}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !!uploading }}
            disabled={!!uploading}
            hitSlop={8}
            onPress={publish}
          >
            <Text style={[styles.headerAction, styles.publish, !!uploading && { opacity: 0.4 }]}>{t("forum.compose.publish")}</Text>
          </Pressable>
        </View>

        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
          {!!restriction && <Text style={styles.restriction}>{restriction}</Text>}

          <Text style={styles.label}>{t("forum.compose.type")}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {FORUM_POST_TYPES.map((item) => (
              <Pressable
                key={item}
                accessibilityRole="button"
                accessibilityState={{ selected: type === item }}
                style={[styles.chip, type === item && styles.chipOn]}
                onPress={() => set("type", item)}
              >
                <Text style={styles.chipIcon}>{FORUM_TYPE_ICONS[item]}</Text>
                <Text style={[styles.chipText, type === item && styles.chipTextOn]}>{t(`forum.type.${item}.label`)}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Text style={styles.hint}>
            {type === "question" ? t("forum.compose.questionHint", { hint: t("forum.type.question.hint") }) : t(`forum.type.${type}.hint`)}
          </Text>

          <Text style={styles.label}>{t("forum.compose.titleLabel")}</Text>
          <TextInput
            value={draft.title}
            onChangeText={(value) => set("title", value)}
            placeholder={titlePlaceholder}
            placeholderTextColor={colors.faint}
            maxLength={FORUM_COMPOSE_TITLE_MAX}
            style={styles.input}
          />
          {submitted && problem === "title" && <Text style={styles.error}>{t("forum.compose.errors.title")}</Text>}

          <Text style={styles.label}>{t("forum.compose.tags")}</Text>
          {tagChoices.length > 0 && (
            <View style={styles.wrap}>
              {tagChoices.map((tag) => {
                const on = draft.tags.some((item) => item.toLowerCase() === tag.toLowerCase());
                return (
                  <Pressable
                    key={tag}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    style={[styles.tag, on && styles.chipOn]}
                    onPress={() => setDraft((current) => ({ ...current, tags: toggleDraftTag(current.tags, tag) }))}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>#{tag}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}
          {!roomTags.length && draft.tags.length < FORUM_COMPOSE_MAX_TAGS && (
            <View style={styles.row}>
              <TextInput
                value={tagDraft}
                onChangeText={setTagDraft}
                placeholder={t("forum.compose.addTag")}
                placeholderTextColor={colors.faint}
                maxLength={FORUM_TAG_LIMITS.maxTagLength}
                onSubmitEditing={addFreeTag}
                returnKeyType="done"
                style={[styles.input, { flex: 1 }]}
              />
              <Pressable accessibilityRole="button" accessibilityLabel={t("forum.compose.addTag")} style={styles.square} onPress={addFreeTag}>
                <Ionicons name="add" size={20} color={colors.cyan} />
              </Pressable>
            </View>
          )}

          {type === "poll" && (
            <View style={styles.section}>
              <Text style={styles.label}>{t("forum.poll.options")}</Text>
              {draft.pollOptions.map((option, index) => (
                <View key={index} style={styles.row}>
                  <TextInput
                    value={option}
                    onChangeText={(value) => set("pollOptions", draft.pollOptions.map((item, i) => (i === index ? value : item)))}
                    placeholder={t("forum.compose.option", { number: index + 1 })}
                    accessibilityLabel={t("forum.compose.option", { number: index + 1 })}
                    placeholderTextColor={colors.faint}
                    maxLength={FORUM_POLL_LIMITS.maxOptionLength}
                    style={[styles.input, { flex: 1 }]}
                  />
                  {draft.pollOptions.length > FORUM_POLL_LIMITS.minOptions && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("forum.compose.removeOption", { number: index + 1 })}
                      style={styles.square}
                      onPress={() => set("pollOptions", draft.pollOptions.filter((_item, i) => i !== index))}
                    >
                      <Ionicons name="close" size={18} color={colors.muted} />
                    </Pressable>
                  )}
                </View>
              ))}
              {draft.pollOptions.length < FORUM_POLL_LIMITS.maxOptions && (
                <Pressable accessibilityRole="button" onPress={() => set("pollOptions", [...draft.pollOptions, ""])}>
                  <Text style={styles.link}>{t("forum.compose.addOption")}</Text>
                </Pressable>
              )}
              {submitted && (problem === "pollOptions" || problem === "pollDuplicate") && (
                <Text style={styles.error}>{t(`forum.compose.errors.${problem}`)}</Text>
              )}
              <View style={styles.switchRow}>
                <Text style={styles.switchText}>{t("forum.compose.multi")}</Text>
                <Switch value={draft.pollMulti} onValueChange={(value) => set("pollMulti", value)} />
              </View>
              <Text style={styles.label}>{t("forum.compose.endsAfter")}</Text>
              <View style={styles.wrap}>
                {POLL_DURATIONS.map((item) => (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: draft.pollDurationMs === item.ms }}
                    style={[styles.tag, draft.pollDurationMs === item.ms && styles.chipOn]}
                    onPress={() => set("pollDurationMs", item.ms)}
                  >
                    <Text style={[styles.chipText, draft.pollDurationMs === item.ms && styles.chipTextOn]}>{t(`forum.compose.pollDuration.${item.id}`)}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {type === "lfg" && (
            <View style={styles.section}>
              <Text style={styles.label}>{t("forum.compose.group")}</Text>
              <TextInput
                value={draft.lfgGame}
                onChangeText={(value) => set("lfgGame", value)}
                placeholder={t("forum.compose.gamePlaceholder")}
                accessibilityLabel={t("forum.lfg.game")}
                placeholderTextColor={colors.faint}
                maxLength={FORUM_LFG_LIMITS.maxGameLength}
                style={styles.input}
              />
              {submitted && problem === "lfgGame" && <Text style={styles.error}>{t("forum.compose.errors.lfgGame")}</Text>}
              <Text style={styles.label}>{t("forum.lfg.platform")}</Text>
              <View style={styles.wrap}>
                {LFG_PLATFORMS.map((platform) => (
                  <Pressable
                    key={platform}
                    accessibilityRole="button"
                    accessibilityState={{ selected: draft.lfgPlatform === platform }}
                    style={[styles.tag, draft.lfgPlatform === platform && styles.chipOn]}
                    onPress={() => set("lfgPlatform", draft.lfgPlatform === platform ? "" : platform)}
                  >
                    <Text style={[styles.chipText, draft.lfgPlatform === platform && styles.chipTextOn]}>{platform}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.label}>{t("forum.compose.players")}</Text>
              <View style={styles.row}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("forum.compose.fewer")}
                  style={styles.square}
                  disabled={draft.lfgSlots <= FORUM_LFG_LIMITS.minSlots}
                  onPress={() => set("lfgSlots", Math.max(FORUM_LFG_LIMITS.minSlots, draft.lfgSlots - 1))}
                >
                  <Ionicons name="remove" size={18} color={colors.text} />
                </Pressable>
                <Text style={styles.slots}>{draft.lfgSlots}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("forum.compose.more")}
                  style={styles.square}
                  disabled={draft.lfgSlots >= FORUM_LFG_LIMITS.maxSlots}
                  onPress={() => set("lfgSlots", Math.min(FORUM_LFG_LIMITS.maxSlots, draft.lfgSlots + 1))}
                >
                  <Ionicons name="add" size={18} color={colors.text} />
                </Pressable>
              </View>
              <Text style={styles.label}>{t("forum.compose.startTime")}</Text>
              <View style={styles.wrap}>
                {LFG_STARTS.map((item) => (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: draft.lfgStartMs === item.ms }}
                    style={[styles.tag, draft.lfgStartMs === item.ms && styles.chipOn]}
                    onPress={() => set("lfgStartMs", item.ms)}
                  >
                    <Text style={[styles.chipText, draft.lfgStartMs === item.ms && styles.chipTextOn]}>{t(`forum.mobile.compose.start.${item.id}`)}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {type === "media" && (
            <View style={styles.section}>
              <Text style={styles.label}>{t("forum.compose.media")}</Text>
              {draft.mediaUrl.startsWith("/uploads/") ? (
                <View style={styles.row}>
                  <Ionicons name="checkmark-circle" size={18} color={colors.green} />
                  <Text style={[styles.switchText, { flex: 1 }]}>{t("forum.compose.uploaded", { type: draft.mediaMime.split("/")[0] || t("forum.compose.fileWord") })}</Text>
                  <Pressable accessibilityRole="button" onPress={() => setDraft((current) => ({ ...current, mediaUrl: "", mediaMime: "" }))}>
                    <Text style={styles.link}>{t("forum.view.remove")}</Text>
                  </Pressable>
                </View>
              ) : (
                <>
                  <TextInput
                    value={draft.mediaUrl}
                    onChangeText={(value) => setDraft((current) => ({ ...current, mediaUrl: value, mediaMime: "" }))}
                    placeholder={t("forum.compose.mediaPlaceholder")}
                    accessibilityLabel={t("forum.compose.mediaLink")}
                    placeholderTextColor={colors.faint}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    style={styles.input}
                  />
                  <Text style={styles.hint}>{t("forum.compose.or")}</Text>
                  <Pressable accessibilityRole="button" style={styles.uploadButton} disabled={!!uploading} onPress={() => void upload("media")}>
                    {uploading === "media" ? <ActivityIndicator color={colors.cyan} /> : <Ionicons name="cloud-upload-outline" size={18} color={colors.cyan} />}
                    <Text style={styles.link}>{uploading === "media" ? t("forum.compose.uploading.media") : t("forum.compose.upload")}</Text>
                  </Pressable>
                </>
              )}
              {submitted && (problem === "media" || problem === "mediaHttps") && <Text style={styles.error}>{t(`forum.compose.errors.${problem}`)}</Text>}
            </View>
          )}

          <Text style={styles.label}>{type === "poll" || type === "lfg" || type === "media" ? t("forum.compose.description") : t("forum.compose.write")}</Text>
          <TextInput
            value={draft.body}
            onChangeText={(value) => set("body", value)}
            placeholder={type === "guide" ? t("forum.compose.bodyPlaceholder.guide") : t("forum.compose.bodyPlaceholder.default")}
            placeholderTextColor={colors.faint}
            maxLength={FORUM_COMPOSE_BODY_MAX}
            multiline
            textAlignVertical="top"
            style={[styles.input, styles.body]}
          />
          {submitted && problem === "body" && <Text style={styles.error}>{t("forum.compose.errors.body")}</Text>}
          <Pressable accessibilityRole="button" style={styles.uploadButton} disabled={!!uploading} onPress={() => void upload("image")}>
            {uploading === "image" ? <ActivityIndicator color={colors.cyan} /> : <Ionicons name="image-outline" size={18} color={colors.cyan} />}
            <Text style={styles.link}>{uploading === "image" ? t("forum.compose.uploading.image") : t("forum.compose.tool.image")}</Text>
          </Pressable>

          <Text style={styles.label}>{t("forum.compose.cover")}</Text>
          {draft.iconUrl ? (
            <View style={styles.cover}>
              <MessageImage url={draft.iconUrl} title={t("forum.compose.coverPreview")} token={token} authenticated />
              <Pressable accessibilityRole="button" onPress={() => set("iconUrl", "")}>
                <Text style={styles.link}>{t("forum.view.remove")}</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable accessibilityRole="button" style={styles.uploadButton} disabled={!!uploading} onPress={() => void upload("cover")}>
              {uploading === "cover" ? <ActivityIndicator color={colors.cyan} /> : <Ionicons name="albums-outline" size={18} color={colors.cyan} />}
              <Text style={styles.link}>{uploading === "cover" ? t("forum.compose.uploading.icon") : t("forum.compose.uploadImage")}</Text>
            </Pressable>
          )}
          <Text style={styles.hint}>{t("forum.compose.coverHint")}</Text>

          {canLockReplies && (
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.switchText}>{t("forum.compose.allowReplies")}</Text>
                <Text style={styles.hint}>{draft.repliesLocked ? t("forum.compose.lockedHint") : t("forum.compose.repliesHint")}</Text>
              </View>
              <Switch value={!draft.repliesLocked} onValueChange={(value) => set("repliesLocked", !value)} />
            </View>
          )}

          {!!error && <Text style={styles.error}>{error}</Text>}
          <Pressable
            accessibilityRole="button"
            style={[styles.primary, (!!problem || !!uploading) && submitted && { opacity: 0.5 }]}
            disabled={!!uploading}
            onPress={publish}
          >
            <Text style={styles.primaryText}>{t("forum.compose.publish")}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.solid },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerAction: { color: colors.muted, fontSize: 15, fontWeight: "700" },
  publish: { color: colors.cyan, fontWeight: "900" },
  kicker: { color: colors.faint, fontSize: 11, fontWeight: "800" },
  headerTitle: { color: colors.text, fontSize: 16, fontWeight: "900" },
  content: { padding: 16, gap: 8 },
  restriction: { color: colors.yellow, fontSize: 13, lineHeight: 18, padding: 10, borderRadius: 12, backgroundColor: colors.panel2 },
  label: { color: colors.muted, fontSize: 12, fontWeight: "900", marginTop: 8, textTransform: "uppercase" },
  hint: { color: colors.faint, fontSize: 12, lineHeight: 16 },
  error: { color: colors.red, fontSize: 12, fontWeight: "700" },
  input: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, color: colors.text, backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border, fontSize: 15 },
  body: { minHeight: 140 },
  chips: { gap: 8, paddingRight: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, height: 36, borderRadius: 99, backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border },
  chipOn: { borderColor: colors.cyan, backgroundColor: colors.cyanSoft },
  chipIcon: { fontSize: 14 },
  chipText: { color: colors.muted, fontSize: 13, fontWeight: "800" },
  chipTextOn: { color: colors.cyan },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tag: { paddingHorizontal: 12, height: 34, justifyContent: "center", borderRadius: 99, backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  square: { width: 40, height: 40, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border },
  slots: { minWidth: 36, textAlign: "center", color: colors.text, fontSize: 17, fontWeight: "900" },
  section: { gap: 8 },
  link: { color: colors.cyan, fontSize: 14, fontWeight: "800" },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 },
  switchText: { color: colors.text, fontSize: 14, fontWeight: "700" },
  uploadButton: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start", paddingVertical: 8 },
  cover: { gap: 6 },
  primary: { marginTop: 16, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.cyan },
  primaryText: { color: "#061018", fontSize: 16, fontWeight: "900" },
});
