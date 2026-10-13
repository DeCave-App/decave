// Settings → Chat: send with Enter or Ctrl+Enter, GIF and emote animation,
// large emoji, spoilers and spellcheck. Only behaviour the app has.

import type { SettingsWindowProps } from "../../../app/views/settings/SettingsWindow";
import { CLIENT_PLATFORM } from "../../../app/env";
import { setChatPrefs, useChatPrefs, type ChatPrefs } from "../chatPrefs";
import { FieldError, SettingsSection, ToggleRow } from "../SettingsControls";
import { useStateField, type SettingField } from "../useSettingField";
import { useSettingsT } from "../useSettingsT";

type Choice<K extends keyof ChatPrefs> = { value: ChatPrefs[K]; labelKey: string; detailKey: string };

function Segmented<K extends "sendWith" | "animate" | "spoilers">({
  field,
  label,
  choices,
}: {
  field: SettingField<ChatPrefs[K]>;
  label: string;
  choices: Choice<K>[];
}) {
  const { tk } = useSettingsT();
  return (
    <>
      <div className={`dcs-segmented dcs-segmented-${choices.length}`} role="radiogroup" aria-label={label}>
        {choices.map((choice) => (
          <button
            key={String(choice.value)}
            type="button"
            role="radio"
            aria-checked={field.value === choice.value}
            className={field.value === choice.value ? "is-active" : ""}
            onClick={() => field.set(choice.value)}
          >
            <strong>{tk(choice.labelKey)}</strong>
            <small>{tk(choice.detailKey)}</small>
          </button>
        ))}
      </div>
      <FieldError field={field} />
    </>
  );
}

export function ChatTab(_props: SettingsWindowProps) {
  const { t } = useSettingsT();
  const prefs = useChatPrefs();
  const mod = CLIENT_PLATFORM === "mac" ? "Cmd" : "Ctrl";
  // Saved on this device at once (setChatPrefs) and synced with the account.
  const pref = <K extends keyof ChatPrefs>(key: K) =>
    [`chat.${key}`, prefs[key], (next: ChatPrefs[K]) => setChatPrefs({ ...prefs, [key]: next }), ["account"]] as const;
  const sendWith = useStateField(...pref("sendWith"));
  const animate = useStateField(...pref("animate"));
  const largeEmoji = useStateField(...pref("largeEmoji"));
  const spoilers = useStateField(...pref("spoilers"));
  const spellcheck = useStateField(...pref("spellcheck"));

  return (
    <>
      <SettingsSection anchor="send-key" title={t("settings.chat.sendTitle")}>
        <Segmented
          field={sendWith}
          label={t("settings.chat.sendTitle")}
          choices={[
            {
              value: "enter",
              labelKey: "settings.chat.send.enter.label",
              detailKey: "settings.chat.send.enter.detail",
            },
            {
              value: "ctrlEnter",
              labelKey: `settings.chat.send.ctrlEnter.label${mod === "Cmd" ? "Mac" : ""}`,
              detailKey: `settings.chat.send.ctrlEnter.detail${mod === "Cmd" ? "Mac" : ""}`,
            },
          ]}
        />
      </SettingsSection>

      <SettingsSection anchor="animate" title={t("settings.chat.animateTitle")}>
        <Segmented
          field={animate}
          label={t("settings.chat.animateTitle")}
          choices={[
            {
              value: "always",
              labelKey: "settings.chat.animate.always.label",
              detailKey: "settings.chat.animate.always.detail",
            },
            {
              value: "hover",
              labelKey: "settings.chat.animate.hover.label",
              detailKey: "settings.chat.animate.hover.detail",
            },
          ]}
        />
      </SettingsSection>

      <SettingsSection title={t("settings.chat.messagesTitle")}>
        <div className="dc-settings-stack">
          <ToggleRow
            anchor="large-emoji"
            field={largeEmoji}
            label={t("settings.chat.largeEmoji")}
            description={t("settings.chat.largeEmojiHelp")}
          />
          <ToggleRow
            anchor="spellcheck"
            field={spellcheck}
            label={t("settings.chat.spellcheck")}
            description={t("settings.chat.spellcheckHelp")}
          />
        </div>
      </SettingsSection>

      <SettingsSection anchor="spoilers" title={t("settings.chat.spoilersTitle")}>
        <Segmented
          field={spoilers}
          label={t("settings.chat.spoilersTitle")}
          choices={[
            {
              value: "click",
              labelKey: "settings.chat.spoilers.click.label",
              detailKey: "settings.chat.spoilers.click.detail",
            },
            {
              value: "always",
              labelKey: "settings.chat.spoilers.always.label",
              detailKey: "settings.chat.spoilers.always.detail",
            },
          ]}
        />
      </SettingsSection>
    </>
  );
}
