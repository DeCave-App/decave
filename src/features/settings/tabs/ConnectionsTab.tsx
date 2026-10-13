// Settings → Connections: Steam, Twitch and FACEIT in one list. Each row
// shows the link, what it is used for, connect / disconnect and "Show on my
// profile". Providers the server has no credentials for are hidden.

import { useCallback, useEffect, useRef, useState } from "react";
import type { SettingsWindowProps } from "../../../app/views/settings/SettingsWindow";
import { HTTP_URL } from "../../../app/env";
import { authorizedFetch } from "../../../app/http";
import { hasDesktopActivityBridge, openDesktopExternalUrl } from "../../../app/desktop";
import { SettingsSection, ToggleRow } from "../SettingsControls";
import { useSettingField, useStateField } from "../useSettingField";
import { useSettingsT } from "../useSettingsT";
import { apiErrorOr, type ApiErrorBody } from "../../../i18n/apiError";
import { BrandLogo } from "../../home/brandIcons";

export type ConnectionProvider = "steam" | "twitch" | "faceit";

export type AccountConnection = {
  provider: ConnectionProvider;
  linked: boolean;
  displayName?: string;
  showOnProfile: boolean;
  available: boolean;
};

const CONNECT_PATH: Record<ConnectionProvider, string> = {
  steam: "/api/integrations/steam/connect",
  twitch: "/api/account/twitch/connect",
  faceit: "/api/account/faceit/connect",
};

const DISCONNECT_PATH: Record<ConnectionProvider, string> = {
  steam: "/api/integrations/steam",
  twitch: "/api/account/twitch",
  faceit: "/api/account/faceit",
};

async function openExternal(url: string): Promise<void> {
  if (hasDesktopActivityBridge()) {
    if (!(await openDesktopExternalUrl(url))) throw new Error("blocked");
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export function ConnectionsTab(props: SettingsWindowProps) {
  const { t } = useSettingsT();
  const [connections, setConnections] = useState<AccountConnection[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const pollRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/account/connections`, { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as { connections?: AccountConnection[] };
      if (!response.ok || !data.connections) throw new Error("load");
      setConnections(data.connections);
      setLoadFailed(false);
      return data.connections;
    } catch {
      setLoadFailed(true);
      return null;
    }
  }, []);

  useEffect(() => {
    void load();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
    };
  }, [load]);

  /** After opening a sign-in page, check every few seconds until the link appears (2 minutes at most). */
  const watchForLink = (provider: ConnectionProvider) => {
    if (pollRef.current !== null) window.clearInterval(pollRef.current);
    const stopAt = Date.now() + 2 * 60_000;
    pollRef.current = window.setInterval(() => {
      void load().then((list) => {
        const done = list?.find((item) => item.provider === provider)?.linked;
        if ((done || Date.now() > stopAt) && pollRef.current !== null) {
          window.clearInterval(pollRef.current);
          pollRef.current = null;
          if (done && provider === "steam") void props.activityActions.refreshSteamIntegration();
        }
      });
    }, 4000);
  };

  const visible = (connections ?? []).filter((item) => item.available);

  return (
    <SettingsSection title={t("settings.connections.title")}>
      <p className="dcs-section-note">{t("settings.connections.intro")}</p>
      {connections === null && !loadFailed && <p className="dcs-muted">{t("settings.connections.loading")}</p>}
      {loadFailed && (
        <p className="dcs-error" role="alert">
          {t("settings.connections.loadFailed")}{" "}
          <button type="button" className="dcs-link-button" onClick={() => void load()}>
            {t("settings.connections.retry")}
          </button>
        </p>
      )}
      <div className="dc-settings-stack">
        {visible.map((connection) => (
          <ConnectionRow
            key={connection.provider}
            connection={connection}
            props={props}
            onChanged={() => void load()}
            onConnectStarted={() => watchForLink(connection.provider)}
          />
        ))}
      </div>
    </SettingsSection>
  );
}

type RowProps = {
  connection: AccountConnection;
  props: SettingsWindowProps;
  onChanged: () => void;
  onConnectStarted: () => void;
};

function ConnectionRow({ connection, props, onChanged, onConnectStarted }: RowProps) {
  const { t, tk } = useSettingsT();
  const { provider } = connection;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [shown, setShown] = useState(connection.showOnProfile);
  useEffect(() => setShown(connection.showOnProfile), [connection.showOnProfile]);

  const showOnProfile = useSettingField(
    `connections.${provider}.showOnProfile`,
    () => shown,
    async (next: boolean) => {
      const response = await authorizedFetch(`${HTTP_URL}/api/account/connections/${provider}/visibility`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ showOnProfile: next }),
      });
      if (!response.ok) throw new Error("save");
    },
    { apply: setShown },
  );

  const { activitySettings, setActivitySettings } = props.preferences;
  const steamPresence = useStateField(
    "connections.steamPresence",
    activitySettings.useSteamPresence,
    (next: boolean) => setActivitySettings((current) => ({ ...current, useSteamPresence: next })),
    ["device"],
  );

  const connect = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await authorizedFetch(`${HTTP_URL}${CONNECT_PATH[provider]}`, { method: "POST" });
      const data = (await response.json().catch(() => ({}))) as { url?: string } & ApiErrorBody;
      if (!response.ok || !data.url) throw new Error(apiErrorOr(data, ""));
      await openExternal(data.url);
      setNotice(t("settings.connections.finishInBrowser"));
      onConnectStarted();
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : t("settings.connections.actionFailed"));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await authorizedFetch(`${HTTP_URL}${DISCONNECT_PATH[provider]}`, { method: "DELETE" });
      if (!response.ok) throw new Error("");
      if (provider === "steam") void props.activityActions.refreshSteamIntegration();
      onChanged();
    } catch {
      setError(t("settings.connections.actionFailed"));
    } finally {
      setBusy(false);
    }
  };

  const steam = props.gameActivity.steamIntegration;
  return (
    <div className="dcs-card" data-settings-anchor={provider}>
      <div className="dcs-card-row">
        <span className="dcs-badge" aria-hidden="true">
          <BrandLogo id={provider} />
        </span>
        <div className="dcs-card-copy">
          <strong>{tk(`settings.connections.providers.${provider}.name`)}</strong>
          <small>
            {connection.linked
              ? t("settings.connections.connected", { name: connection.displayName ?? "" })
              : t("settings.connections.notConnected")}
          </small>
          <small>{tk(`settings.connections.providers.${provider}.use`)}</small>
        </div>
        {connection.linked ? (
          <button type="button" className="modal-secondary" disabled={busy} onClick={() => void disconnect()}>
            {t("settings.connections.disconnect")}
          </button>
        ) : (
          <button type="button" className="modal-primary" disabled={busy} onClick={() => void connect()}>
            {busy ? t("settings.connections.connecting") : t("settings.connections.connect")}
          </button>
        )}
      </div>
      {connection.linked && (
        <ToggleRow field={showOnProfile} label={t("settings.connections.showOnProfile")} style={{ marginTop: 10 }} />
      )}
      {provider === "steam" && (
        <>
          <ToggleRow
            field={steamPresence}
            style={{ marginTop: 10 }}
            label={t("settings.connections.steamPresence")}
            description={t("settings.connections.steamPresenceHelp")}
          />
          {connection.linked && (
            <div className="dcs-card-actions">
              <small className="dcs-muted">
                {steam.gameName
                  ? t("settings.connections.steamPlaying", { game: steam.gameName })
                  : t("settings.connections.steamIdle")}
              </small>
              <button
                type="button"
                className="modal-secondary"
                onClick={() => void props.activityActions.runAutomaticActivityScan(true)}
              >
                {t("settings.connections.checkActivity")}
              </button>
            </div>
          )}
        </>
      )}
      {notice && <p className="dcs-muted">{notice}</p>}
      {error && (
        <p className="dcs-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
