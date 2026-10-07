// The status bar along the bottom of the window.

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
  return (
    <footer className="dc-app-bottom-bar" aria-label="Application status">
      <div className="dc-bottom-bar-context">
        <span
          className={`dc-bottom-bar-status ${connectionStatus === "Connected" ? "is-online" : ""}`}
          aria-hidden="true"
        />
        <strong>{connectionStatus === "Connected" ? "Connected" : connectionStatus}</strong>
        <span className="dc-bottom-bar-divider" aria-hidden="true" />
        <span className="dc-bottom-bar-location">
          {showAdminDashboard
            ? "Admin"
            : showSettings
              ? "Settings"
              : showSocial
                ? socialView === "dm"
                  ? "Direct Messages"
                  : "Friends"
                : showServerBrowser
                  ? "Discover Hubs"
                  : showHome
                    ? "Dashboard"
                    : `${currentServer.name} · ${currentChannel.name}`}
        </span>
      </div>
      {voiceChannelId !== null && (
        <div className="dc-bottom-bar-actions">
          <span className="dc-bottom-bar-voice">● Voice · {voiceCall.voiceStatus}</span>
        </div>
      )}
    </footer>
  );
}
