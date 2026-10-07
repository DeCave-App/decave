import type { AccountUser } from "../../types";
import { formatActivityElapsed } from "../../format";
import { hasDesktopActivityBridge } from "../../desktop";
import { settingsSectionStyle, settingsSectionTitleStyle, settingsLabelStyle } from "../../inline-styles";
import type { PreferencesState } from "../../state/preferences";
import type { GameActivityState } from "../../state/game-activity";

type Props = {
  currentUser: AccountUser;
  runAutomaticActivityScan: (forceSteam?: boolean) => Promise<void>;
  connectSteam: () => Promise<void>;
  disconnectSteam: () => Promise<void>;
  automaticActivityElapsed: string;
  currentGameIcon: string;
  preferences: PreferencesState;
  gameActivity: GameActivityState;
};

export function ActivitySettingsSection({
  currentUser,
  runAutomaticActivityScan,
  connectSteam,
  disconnectSteam,
  automaticActivityElapsed,
  currentGameIcon,
  preferences,
  gameActivity,
}: Props) {
  const { activityState, steamIntegration, detectedDesktopGame, activityNotice, activityBusy, activityNow } =
    gameActivity;
  const { accountPreferences, setAccountPreferences, activitySettings, setActivitySettings } = preferences;
  return (
    <>
      <div style={settingsSectionStyle}>
        <div style={settingsSectionTitleStyle}>WHO CAN SEE YOUR GAME</div>
        <div className="dcs-card">
          <div
            className="dcs-segmented dcs-segmented-3"
            role="radiogroup"
            aria-label="Who can see the game you're playing"
          >
            {(
              [
                ["everyone", "Everyone", "Anyone who can see your profile"],
                ["friends", "Friends", "Only people on your friends list"],
                ["nobody", "Nobody", "Keep it to yourself"],
              ] as const
            ).map(([value, label, detail]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={accountPreferences.activityVisibility === value}
                className={accountPreferences.activityVisibility === value ? "is-active" : ""}
                onClick={() => setAccountPreferences((current) => ({ ...current, activityVisibility: value }))}
              >
                <strong>{label}</strong>
                <small>{detail}</small>
              </button>
            ))}
          </div>
          <p className="dcs-muted">DeCave enforces this for everyone else. You always see your own game here.</p>
        </div>
      </div>

      <div style={settingsSectionStyle}>
        <div style={settingsSectionTitleStyle}>AUTOMATIC ACTIVITY</div>
        <div
          style={{
            display: "grid",
            gap: "12px",
            padding: "15px",
            borderRadius: "14px",
            border: "1px solid color-mix(in srgb, var(--ds-accent-2) 16%, transparent)",
            background: "linear-gradient(145deg, rgba(12, 28, 46, .72), rgba(24, 15, 50, .52))",
          }}
        >
          <div className="dc-activity-hero">
            <div className="dc-activity-game-icon">
              {currentGameIcon ? <img src={currentGameIcon} alt="" /> : <span>▶</span>}
            </div>
            <div>
              <strong>{activityState?.effectiveText || currentUser.activityText || "No activity"}</strong>
              <small>
                {activityState?.automaticText
                  ? `Automatic · ${activityState.source || "detected"}${automaticActivityElapsed ? ` · Playing for ${automaticActivityElapsed}` : ""}`
                  : "No automatic game activity detected"}
              </small>
            </div>
            {activityState?.automaticText && <span className="dc-live-pill">LIVE</span>}
          </div>

          <label className={`settings-toggle-row${activitySettings.publishAutomatic ? " enabled" : " disabled"}`}>
            <span>
              <strong>Display automatic activity</strong>
              <small>Publish detected games to your DeCave profile</small>
            </span>
            <span className="settings-toggle-control">
              <em>{activitySettings.publishAutomatic ? "ON" : "OFF"}</em>
              <input
                type="checkbox"
                checked={activitySettings.publishAutomatic}
                onChange={(event) =>
                  setActivitySettings((current) => ({ ...current, publishAutomatic: event.target.checked }))
                }
              />
            </span>
          </label>

          <label
            className={`settings-toggle-row${activitySettings.autoDetectLocal ? " enabled" : " disabled"}`}
            style={!hasDesktopActivityBridge() ? { opacity: 0.62 } : undefined}
          >
            <span>
              <strong>Detect games on this computer</strong>
              <small>
                {hasDesktopActivityBridge()
                  ? "Checks running apps on this device and matches your Steam and Epic games. Nothing leaves your computer except the game name."
                  : "Available in the DeCave desktop app"}
              </small>
            </span>
            <span className="settings-toggle-control">
              <em>{activitySettings.autoDetectLocal ? "ON" : "OFF"}</em>
              <input
                type="checkbox"
                disabled={!hasDesktopActivityBridge()}
                checked={activitySettings.autoDetectLocal}
                onChange={(event) =>
                  setActivitySettings((current) => ({ ...current, autoDetectLocal: event.target.checked }))
                }
              />
            </span>
          </label>

          {hasDesktopActivityBridge() && activitySettings.autoDetectLocal && (
            <div
              style={{
                padding: "11px 12px",
                borderRadius: "10px",
                background: "color-mix(in srgb, var(--ds-accent-2) 5%, transparent)",
                border: "1px solid color-mix(in srgb, var(--ds-accent-2) 12%, transparent)",
                color: "var(--ds-text-soft)",
                fontSize: "12px",
              }}
            >
              {detectedDesktopGame
                ? `Detected ${detectedDesktopGame.source === "steam" ? "Steam" : "Epic"}: ${detectedDesktopGame.gameName}${formatActivityElapsed(detectedDesktopGame.startedAt, activityNow) ? ` · Playing for ${formatActivityElapsed(detectedDesktopGame.startedAt, activityNow)}` : ""}`
                : "No running Steam or Epic game detected right now."}
            </div>
          )}

          <label style={settingsLabelStyle}>
            Excluded games
            <input
              value={activitySettings.excludedGames.join(", ")}
              onChange={(event) =>
                setActivitySettings((current) => ({
                  ...current,
                  excludedGames: event.target.value
                    .split(",")
                    .map((item) => item.trim())
                    .slice(0, 50),
                }))
              }
              placeholder="Game One, Game Two"
            />
            <small style={{ color: "var(--ds-muted)", marginTop: "6px", display: "block", lineHeight: 1.45 }}>
              Exact game names, separated by commas. Detection stays local; excluded titles are not published.
            </small>
          </label>
        </div>
      </div>

      <div style={settingsSectionStyle}>
        <div style={settingsSectionTitleStyle}>STEAM</div>
        <div
          style={{
            display: "grid",
            gap: "12px",
            padding: "15px",
            borderRadius: "14px",
            border: "1px solid color-mix(in srgb, var(--ds-accent) 18%, transparent)",
            background: "var(--ds-surface-2)",
          }}
        >
          <label className={`settings-toggle-row${activitySettings.useSteamPresence ? " enabled" : " disabled"}`}>
            <span>
              <strong>Use Steam presence</strong>
              <small>Use your linked Steam account when no local game is detected</small>
            </span>
            <span className="settings-toggle-control">
              <em>{activitySettings.useSteamPresence ? "ON" : "OFF"}</em>
              <input
                type="checkbox"
                checked={activitySettings.useSteamPresence}
                onChange={(event) =>
                  setActivitySettings((current) => ({ ...current, useSteamPresence: event.target.checked }))
                }
              />
            </span>
          </label>

          {steamIntegration.linked ? (
            <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
              <div
                style={{
                  width: "46px",
                  height: "46px",
                  borderRadius: "12px",
                  display: "grid",
                  placeItems: "center",
                  background: "color-mix(in srgb, var(--ds-accent) 16%, transparent)",
                  color: "var(--ds-accent)",
                  fontWeight: 900,
                }}
              >
                S
              </div>
              <div style={{ flex: 1, minWidth: "180px" }}>
                <strong style={{ color: "var(--ds-text)" }}>
                  {steamIntegration.personaName || "Steam account connected"}
                </strong>
                <div style={{ color: "var(--ds-muted)", fontSize: "12px", marginTop: "4px" }}>
                  {steamIntegration.gameName
                    ? `Playing ${steamIntegration.gameName}`
                    : steamIntegration.apiConfigured
                      ? "No public Steam game activity right now"
                      : "Steam linked · Web API key not configured"}
                </div>
              </div>
              <button
                type="button"
                className="modal-secondary"
                disabled={activityBusy}
                onClick={() => void disconnectSteam()}
              >
                Disconnect
              </button>
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                flexWrap: "wrap",
              }}
            >
              <div>
                <strong style={{ color: "var(--ds-text)" }}>Connect your Steam account</strong>
                <div
                  style={{
                    color: "var(--ds-muted)",
                    fontSize: "12px",
                    marginTop: "4px",
                    maxWidth: "540px",
                    lineHeight: 1.5,
                  }}
                >
                  Steam OpenID links your SteamID to DeCave. Your Steam password is entered only on Steam.
                </div>
              </div>
              <button
                type="button"
                className="modal-primary"
                disabled={activityBusy}
                onClick={() => void connectSteam()}
              >
                {activityBusy ? "Opening..." : "Connect Steam"}
              </button>
            </div>
          )}

          {!steamIntegration.apiConfigured && (
            <div
              style={{
                color: "var(--ds-warn)",
                fontSize: "12px",
                lineHeight: 1.5,
                padding: "9px 11px",
                border: "1px solid color-mix(in srgb, var(--ds-warn) 20%, transparent)",
                borderRadius: "9px",
                background: "color-mix(in srgb, var(--ds-warn) 5%, transparent)",
              }}
            >
              Steam linking works without a Web API key. To read Steam presence from the cloud, add the Worker secret{" "}
              <strong>STEAM_WEB_API_KEY</strong>. Local Steam detection still works without it.
            </div>
          )}

          {activityNotice && (
            <div style={{ color: "var(--ds-text-soft)", fontSize: "12px", lineHeight: 1.5 }}>{activityNotice}</div>
          )}
          <button type="button" className="modal-secondary" onClick={() => void runAutomaticActivityScan(true)}>
            Check Activity Now
          </button>
        </div>
      </div>
    </>
  );
}
