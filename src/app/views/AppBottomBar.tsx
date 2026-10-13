// The status bar along the bottom of the window.

import { connectionStatusLabel } from "./statusLabels";
import { useTranslation } from "react-i18next";
import type { Channel, Server } from "../types";
import type { VoiceCallState } from "../state/voice-call";

type Props = {
  showSettings: boolean;
  voiceCall: VoiceCallState;
  showAdminDashboard: boolean;
  showHome: boolean;
  connectionStatus: string;
  showServerBrowser: boolean;
  showSocial: boolean;
  socialView: "dm" | "friends";
  voiceChannelId: number | null;
  currentServer: Server;
  currentChannel: Channel;
};

export function AppBottomBar({
  showSettings,
  voiceCall,
  showAdminDashboard,
  showHome,
  connectionStatus,
  showServerBrowser,
  showSocial,
  socialView,
  voiceChannelId,
  currentServer,
  currentChannel,
}: Props) {
  const { t } = useTranslation(["common", "hub", "chat"]);
  return (
    <footer className="dc-app-bottom-bar" aria-label={t("common.bottomBar.label")}>
      <div className="dc-bottom-bar-context">
        <span
          className={`dc-bottom-bar-status ${connectionStatus === "Connected" ? "is-online" : ""}`}
          aria-hidden="true"
        />
        <strong>{connectionStatusLabel(connectionStatus)}</strong>
        <span className="dc-bottom-bar-divider" aria-hidden="true" />
        <span className="dc-bottom-bar-location">
          {showAdminDashboard
            ? t("common.bottomBar.admin")
            : showSettings
              ? t("common.bottomBar.settings")
              : showSocial
                ? socialView === "dm"
                  ? t("common.bottomBar.directMessages")
                  : t("common.bottomBar.friends")
                : showServerBrowser
                  ? t("common.bottomBar.discoverHubs")
                  : showHome
                    ? t("common.bottomBar.dashboard")
                    : `${currentServer.name} · ${currentChannel.name}`}
        </span>
      </div>
      {voiceChannelId !== null && (
        <div className="dc-bottom-bar-actions">
          <span className="dc-bottom-bar-voice">
            {t("common.bottomBar.voice", { status: connectionStatusLabel(voiceCall.voiceStatus) })}
          </span>
        </div>
      )}
    </footer>
  );
}
