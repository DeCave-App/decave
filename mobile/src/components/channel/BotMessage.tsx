// A builder-bot message in a Hub room: BOT badge, text, card with buttons or
// a select, the "Only you can see this" private notice, and a native modal
// for bot forms. Card content is untrusted: plain text, https links only and
// no external image loads (a card image is an "Open image" link).

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { ModalKeyboardAvoider } from "@/src/components/KeyboardAware";
import { apiJson } from "@/src/lib/api";
import { linkStyle, openLink } from "@/src/components/LinkifiedText";
import { colors } from "@/src/theme";
import {
  cardButtons,
  cardFields,
  cardSelect,
  cardTextParts,
  formFromResponse,
  formPayload,
  interactionBody,
  missingRequired,
  safeCardLink,
  type BotForm,
  type MessageBot,
} from "../../../../shared/bots/card-view";

type Props = {
  messageId: string;
  roomId: number;
  bot: MessageBot;
  card: Record<string, unknown> | null | undefined;
  privateNotice?: boolean;
  text: string;
  token: string | null;
  /** False when the chat row already names the bot as the author. */
  showHead?: boolean;
};

/** BOT badge; the bot's colour is only a small dot so any colour stays readable. */
export function BotBadge({ color }: { color: string | null }) {
  const { t } = useTranslation(["common", "bots"]);
  return (
    <View style={styles.badge}>
      {color ? <View style={[styles.badgeDot, { backgroundColor: color }]} /> : null}
      <Text style={styles.badgeText}>{t("bots.card.badge")}</Text>
    </View>
  );
}

function CardText({ text, style }: { text: unknown; style?: object }) {
  return (
    <Text style={style ?? styles.text}>
      {cardTextParts(text).map((part, index) =>
        part.kind === "link" ? (
          <Text key={index} style={linkStyle} accessibilityRole="link" onPress={() => openLink(part.value)}>
            {part.value}
          </Text>
        ) : (
          part.value
        ),
      )}
    </Text>
  );
}

function FormModal({ form, roomId, token, onClose }: { form: BotForm; roomId: number; token: string | null; onClose: () => void }) {
  const { t } = useTranslation(["common", "bots"]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const missing = missingRequired(form.fields, values);
    if (missing.length) {
      setError(t("bots.card.form.required", { field: missing[0] }));
      return;
    }
    setBusy(true);
    setError("");
    try {
      await apiJson(
        `/api/rooms/${roomId}/bot-forms/${encodeURIComponent(form.formId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formPayload(form.fields, values)),
        },
        token,
      );
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("bots.card.form.sendFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <ModalKeyboardAvoider>
      <View style={styles.overlay}>
        <View style={styles.dialog} accessibilityViewIsModal>
          <Text style={styles.dialogTitle}>{form.title}</Text>
          {form.fields.map((field, index) => (
            <View key={field.id} style={styles.field}>
              <Text style={styles.fieldLabel}>
                {field.label}
                {field.required ? <Text style={styles.required}> *</Text> : null}
              </Text>
              <TextInput
                style={[styles.input, field.style === "long" && styles.inputLong]}
                multiline={field.style === "long"}
                maxLength={1000}
                autoFocus={index === 0}
                placeholderTextColor={colors.faint}
                value={values[field.id] ?? ""}
                onChangeText={(value) => setValues((current) => ({ ...current, [field.id]: value }))}
              />
            </View>
          ))}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" style={[styles.button, styles.secondary]} onPress={onClose}>
              <Text style={styles.buttonText}>{t("common.actions.cancel")}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={[styles.button, styles.primary, busy && styles.disabled]}
              disabled={busy}
              onPress={() => void submit()}
            >
              <Text style={[styles.buttonText, styles.onColor]}>{busy ? t("common.status.sending") : t("bots.card.form.submit")}</Text>
            </Pressable>
          </View>
        </View>
      </View>
      </ModalKeyboardAvoider>
    </Modal>
  );
}

export function BotMessage({ messageId, roomId, bot, card, privateNotice, text, token, showHead = true }: Props) {
  const { t } = useTranslation(["common", "bots"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<BotForm | null>(null);
  const [selected, setSelected] = useState("");

  const buttons = cardButtons(card);
  const select = cardSelect(card);
  const fields = cardFields(card);
  const imageLink = safeCardLink(card?.imageUrl);
  const title = typeof card?.title === "string" ? card.title : "";
  const cardText = typeof card?.text === "string" ? card.text : "";
  const accent = typeof card?.color === "string" && /^#[0-9a-fA-F]{6}$/.test(card.color) ? card.color : colors.violet;

  const interact = async (customId: string, value?: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const data = await apiJson<unknown>(
        `/api/rooms/${roomId}/bot-interactions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(interactionBody(messageId, customId, value)),
        },
        token,
      );
      const next = formFromResponse(data, t("bots.card.form.untitled"));
      if (next) setForm(next);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("bots.card.noAnswer"));
    } finally {
      setBusy(false);
    }
  };

  const styleFor = (style: string) =>
    style === "primary" ? styles.primary : style === "danger" ? styles.danger : style === "success" ? styles.success : styles.secondary;

  return (
    <View style={[styles.message, privateNotice && styles.private]}>
      {showHead ? (
        <View style={styles.head}>
          {bot.avatarEmoji ? <Text>{bot.avatarEmoji}</Text> : null}
          <BotBadge color={bot.color} />
          <Text style={styles.name}>{bot.name}</Text>
          {privateNotice ? <Text style={styles.privateLabel}>{t("bots.card.privateNotice")}</Text> : null}
        </View>
      ) : privateNotice ? (
        <Text style={styles.privateLabel}>{t("bots.card.privateNotice")}</Text>
      ) : null}
      {text ? <CardText text={text} /> : null}
      {card ? (
        <View style={[styles.card, { borderLeftColor: accent }]}>
          {title ? <Text style={styles.cardTitle}>{title}</Text> : null}
          {cardText ? <CardText text={cardText} /> : null}
          {fields.map((field, index) => (
            <View key={index}>
              <Text style={styles.fieldName}>{field.name}</Text>
              <CardText text={field.value} />
            </View>
          ))}
          {imageLink ? (
            <Text style={linkStyle} accessibilityRole="link" onPress={() => openLink(imageLink)}>
              {t("bots.card.openImage")}
            </Text>
          ) : null}
          {buttons.length ? (
            <View style={styles.buttons}>
              {buttons.map((button) => (
                <Pressable
                  key={button.customId}
                  accessibilityRole="button"
                  disabled={busy}
                  style={[styles.button, styleFor(button.style), busy && styles.disabled]}
                  onPress={() => void interact(button.customId)}
                >
                  <Text style={[styles.buttonText, button.style !== "secondary" && styles.onColor]}>{button.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {select ? (
            <View style={styles.buttons} accessibilityLabel={t("bots.card.chooseOption")}>
              {select.options.map((option) => (
                <Pressable
                  key={option.value}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: selected === option.value }}
                  disabled={busy}
                  style={[styles.button, selected === option.value ? styles.primary : styles.secondary, busy && styles.disabled]}
                  onPress={() => {
                    setSelected(option.value);
                    void interact(select.customId, option.value);
                  }}
                >
                  <Text style={[styles.buttonText, selected === option.value && styles.onColor]}>{option.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      ) : null}
      {form ? <FormModal form={form} roomId={roomId} token={token} onClose={() => setForm(null)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  message: { gap: 6 },
  private: { padding: 8, borderRadius: 10, borderWidth: 1, borderStyle: "dashed", borderColor: colors.borderStrong, backgroundColor: colors.panel2 },
  head: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  badge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, backgroundColor: colors.violet },
  badgeDot: { width: 6, height: 6, borderRadius: 3, borderWidth: 1, borderColor: "#FFFFFF" },
  badgeText: { color: "#FFFFFF", fontSize: 9, fontWeight: "900" },
  name: { color: colors.text, fontSize: 13, fontWeight: "800" },
  privateLabel: { color: colors.muted, fontSize: 11, fontStyle: "italic" },
  text: { color: colors.text, fontSize: 13, lineHeight: 19 },
  card: { gap: 6, padding: 10, borderRadius: 10, borderWidth: 1, borderLeftWidth: 4, borderColor: colors.border, backgroundColor: colors.panel2 },
  cardTitle: { color: colors.text, fontSize: 14, fontWeight: "900" },
  fieldName: { color: colors.muted, fontSize: 11, fontWeight: "800" },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  button: { minHeight: 34, paddingHorizontal: 12, justifyContent: "center", borderRadius: 8, borderWidth: 1, borderColor: "transparent" },
  primary: { backgroundColor: colors.violet },
  secondary: { backgroundColor: colors.wash, borderColor: colors.borderStrong },
  danger: { backgroundColor: colors.red },
  success: { backgroundColor: colors.green },
  disabled: { opacity: 0.6 },
  buttonText: { color: colors.text, fontSize: 13, fontWeight: "800" },
  onColor: { color: "#FFFFFF" },
  error: { color: colors.red, fontSize: 12 },
  overlay: { flex: 1, justifyContent: "center", padding: 20, backgroundColor: colors.overlay },
  dialog: { gap: 12, padding: 18, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.sheet },
  dialogTitle: { color: colors.text, fontSize: 17, fontWeight: "900" },
  field: { gap: 4 },
  fieldLabel: { color: colors.text, fontSize: 13, fontWeight: "700" },
  required: { color: colors.red },
  input: { minHeight: 40, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.input, color: colors.text, fontSize: 14 },
  inputLong: { minHeight: 96, textAlignVertical: "top" },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
});
