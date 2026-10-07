// Settings > Support & about.

import type { Dispatch, SetStateAction } from "react";
import { SupportPanel, platformName } from "../../../features/settings";
import type { Server, AccountUser } from "../../types";
import { CLIENT_PLATFORM } from "../../env";
import { hasDesktopActivityBridge, openDesktopExternalUrl } from "../../desktop";
import { settingsSectionStyle, settingsSectionTitleStyle } from "../../inline-styles";

type Props = {
  currentUser: AccountUser;
  settingsDirty: boolean;
  setSettingsCloseConfirm: Dispatch<SetStateAction<boolean>>;
  servers: Server[];
  setShowHubHome: Dispatch<SetStateAction<boolean>>;
  finishCloseSettings: () => void;
  changeServer: (serverId: number, availableServers?: Server[]) => void;
  changeChannel: (channelId: number) => void;
  desktopInstalledVersion: string;
};

export function SupportSettingsSection({
  currentUser,
  settingsDirty,
  setSettingsCloseConfirm,
  servers,
  setShowHubHome,
  finishCloseSettings,
  changeServer,
  changeChannel,
  desktopInstalledVersion,
}: Props) {
  return (
    <>
      <div style={settingsSectionStyle}>
        <div style={settingsSectionTitleStyle}>HELP</div>
        <SupportPanel
          appName={hasDesktopActivityBridge() ? "DeCave Desktop" : "DeCave Web"}
          version={desktopInstalledVersion}
          platform={platformName(CLIENT_PLATFORM)}
          username={currentUser.username}
          canOpenMail={!hasDesktopActivityBridge()}
          openExternal={
            hasDesktopActivityBridge() ? (url) => void openDesktopExternalUrl(url).catch(() => undefined) : null
          }
          onOpenPatchNotes={(() => {
            const hub = servers.find((server) => server.channels.some((channel) => channel.name === "patch-notes"));
            const room = hub?.channels.find((channel) => channel.name === "patch-notes");
            if (!hub || !room) return null;
            return () => {
              if (settingsDirty) {
                setSettingsCloseConfirm(true);
                return;
              }
              finishCloseSettings();
              changeServer(hub.id);
              changeChannel(room.id);
              setShowHubHome(false);
            };
          })()}
        />
      </div>
    </>
  );
}
