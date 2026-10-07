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

/** Settings → Keybinds: every shortcut DeCave understands, in one list. */
export function ShortcutsPanel({ mod, pushToTalkKey, muteShortcut, deafenShortcut }: Props) {
  const groups: Array<{ title: string; rows: Array<[string, string]> }> = [
    {
      title: "Anywhere",
      rows: [
        [`${mod}+K`, "Search and jump to a Hub, room or person"],
        [`${mod}+Shift+I`, "Open your inbox"],
        ["Esc", "Close the open menu, dialog or Settings"],
      ],
    },
    {
      title: "Voice",
      rows: [
        ...(pushToTalkKey ? [[pushToTalkKey, "Hold to talk (Push to Talk)"] as [string, string]] : []),
        [muteShortcut, "Mute or unmute your microphone (desktop app, works in games)"],
        [deafenShortcut, "Deafen or undeafen (desktop app, works in games)"],
      ],
    },
    {
      title: "Hub sidebar (owners and admins)",
      rows: [
        ["Alt+↑", "Move the focused room up inside its box"],
        ["Alt+↓", "Move the focused room down inside its box"],
      ],
    },
    {
      title: "Writing a forum post",
      rows: [
        [`${mod}+B`, "Bold"],
        [`${mod}+I`, "Italic"],
        [`${mod}+K`, "Add a link"],
        [`${mod}+Enter`, "Publish"],
      ],
    },
  ];
  return (
    <div className="dcs-card dcs-shortcuts">
      {groups.map((group) => (
        <section key={group.title}>
          <h4>{group.title}</h4>
          <dl>
            {group.rows.map(([keys, label]) => (
              <div key={`${group.title}-${keys}`}>
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
