// DM and group list previews in the UI language (catalog keys under dm.preview).

import { dmPreviewText, type DmPreviewLabels } from "../../shared/dm-message-preview";
import { i18next } from "./index.ts";

/** Preview words, read when each preview is made so a language switch applies. */
export const dmPreviewLabels: DmPreviewLabels = {
  gif: () => i18next.t("dm.preview.gif"),
  attachment: () => i18next.t("dm.preview.attachment"),
  namedAttachment: (name) => i18next.t("dm.preview.namedAttachment", { name }),
  poll: () => i18next.t("dm.preview.poll"),
  pollQuestion: (question) => i18next.t("dm.preview.pollQuestion", { question }),
  voice: (duration) => i18next.t("chat.voice.preview", { duration }),
  message: () => i18next.t("dm.preview.message"),
  encrypted: () => i18next.t("dm.preview.encrypted"),
};

/** One-line list preview for a DM or group message, in the UI language. */
export const translatedDmPreview = (text: string): string => dmPreviewText(text, dmPreviewLabels);
