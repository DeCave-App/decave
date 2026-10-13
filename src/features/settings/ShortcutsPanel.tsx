import { useSettingsT } from "./useSettingsT";

type Props = {
  /** "Ctrl" on Windows/Linux, "Cmd" on macOS. */
  mod: string;
  pushToTalkKey: string | null;
  muteShortcut: string;
  deafenShortcut: string;
};

function Keys({ value }: { value: string }) {
  return (
    <span className="dcs-keys">
      {value
        .split(/\s*\+\s*/)
        .filter(Boolean)
        .map((key) => (
          <kbd key={key}>{key}</kbd>
        ))}
    </span>
  );
}

/** Settings → Gaming & overlay: every shortcut DeCave understands, in one list. */
export function ShortcutsPanel({ mod, pushToTalkKey, muteShortcut, deafenShortcut }: Props) {
  const { t } = useSettingsT();
  const groups: Array<{ id: string; title: string; rows: Array<[string, string]> }> = [
    {
      id: "anywhere",
      title: t("settings.shortcuts.anywhere"),
      rows: [
        [`${mod}+K`, t("settings.shortcuts.search")],
        [`${mod}+Shift+I`, t("settings.shortcuts.inbox")],
        ["Esc", t("settings.shortcuts.escape")],
      ],
    },
    {
      id: "voice",
      title: t("settings.shortcuts.voice"),
      rows: [
        ...(pushToTalkKey ? [[pushToTalkKey, t("settings.shortcuts.pushToTalk")] as [string, string]] : []),
        [muteShortcut, t("settings.shortcuts.mute")],
        [deafenShortcut, t("settings.shortcuts.deafen")],
      ],
    },
    {
      id: "sidebar",
      title: t("settings.shortcuts.sidebar"),
      rows: [
        ["Alt+↑", t("settings.shortcuts.moveUp")],
        ["Alt+↓", t("settings.shortcuts.moveDown")],
      ],
    },
    {
      id: "forum",
      title: t("settings.shortcuts.forum"),
      rows: [
        [`${mod}+B`, t("settings.shortcuts.bold")],
        [`${mod}+I`, t("settings.shortcuts.italic")],
        [`${mod}+K`, t("settings.shortcuts.link")],
        [`${mod}+Enter`, t("settings.shortcuts.publish")],
      ],
    },
  ];
  return (
    <div className="dcs-card dcs-shortcuts">
      {groups.map((group) => (
        <section key={group.id}>
          <h4>{group.title}</h4>
          <dl>
            {group.rows.map(([keys, label]) => (
              <div key={`${group.id}-${keys}`}>
                <dt>
                  <Keys value={keys} />
                </dt>
                <dd>{label}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
