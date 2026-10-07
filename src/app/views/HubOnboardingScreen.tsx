// First-run screen for accounts with no Hubs yet: create a Hub or join a public one.

import type { Dispatch, SetStateAction } from "react";
import type { HubTemplateId } from "../../../shared/hub-templates";
import { CreateHubModal } from "../../features/create-hub/CreateHubModal";
import type { DiscordImportPreview } from "../../../shared/discord-template";
import type { ServerVisibility, DiscoverServer, AccountUser, AppSkin } from "../types";
import { DeCaveBrand } from "../components/DeCaveBrand";
import { DiscordImportPanel } from "../components/DiscordImportPanel";
import {
  discoverServerCardStyle,
  discoverServerIconStyle,
  errorTextStyle,
  authSwitchStyle,
  memberMutedStyle,
} from "../inline-styles";

type Props = {
  currentUser: AccountUser;
  displaySkin: AppSkin;
  setHubOnboardingSkipped: Dispatch<SetStateAction<boolean>>;
  setShowHome: Dispatch<SetStateAction<boolean>>;
  showCreateServer: boolean;
  setShowCreateServer: Dispatch<SetStateAction<boolean>>;
  newServerName: string;
  setNewServerName: Dispatch<SetStateAction<string>>;
  newServerVisibility: ServerVisibility;
  setNewServerVisibility: Dispatch<SetStateAction<ServerVisibility>>;
  newServerTemplate: HubTemplateId;
  setNewServerTemplate: Dispatch<SetStateAction<HubTemplateId>>;
  creatingServer: boolean;
  discordImportPreview: DiscordImportPreview | null;
  setDiscordImportPreview: Dispatch<SetStateAction<DiscordImportPreview | null>>;
  discordImportBusy: boolean;
  discordImportError: string;
  setDiscordImportError: Dispatch<SetStateAction<string>>;
  serverCreateError: string;
  setServerCreateError: Dispatch<SetStateAction<string>>;
  showServerBrowser: boolean;
  setShowServerBrowser: Dispatch<SetStateAction<boolean>>;
  discoverSearch: string;
  setDiscoverSearch: Dispatch<SetStateAction<string>>;
  discoverLoading: boolean;
  discoverError: string;
  streamerHubsEnabled: boolean;
  loadDiscoverServers: () => Promise<DiscoverServer[] | null>;
  openServerBrowser: () => void;
  createServer: (iconFile?: File | null) => Promise<void>;
  loadDiscordTemplate: (value: string) => Promise<void>;
  joinPublicServer: (serverId: number) => Promise<void>;
  filteredDiscoverServers: DiscoverServer[];
};

export function HubOnboardingScreen({
  currentUser,
  displaySkin,
  setHubOnboardingSkipped,
  setShowHome,
  showCreateServer,
  setShowCreateServer,
  newServerName,
  setNewServerName,
  newServerVisibility,
  setNewServerVisibility,
  newServerTemplate,
  setNewServerTemplate,
  creatingServer,
  discordImportPreview,
  setDiscordImportPreview,
  discordImportBusy,
  discordImportError,
  setDiscordImportError,
  serverCreateError,
  setServerCreateError,
  showServerBrowser,
  setShowServerBrowser,
  discoverSearch,
  setDiscoverSearch,
  discoverLoading,
  discoverError,
  streamerHubsEnabled,
  loadDiscoverServers,
  openServerBrowser,
  createServer,
  loadDiscordTemplate,
  joinPublicServer,
  filteredDiscoverServers,
}: Props) {
  return (
    <div className="username-screen vadrion-auth-screen" data-skin={displaySkin}>
      <div className="username-card vadrion-empty-card" style={{ width: "min(760px, 92vw)", maxWidth: "760px" }}>
        <DeCaveBrand />
        <h1>Welcome to DeCave</h1>
        <p>Create a Hub, join a public community, or skip this step and do it later.</p>

        {!showCreateServer && !showServerBrowser && (
          <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => {
                setNewServerName("");
                setNewServerVisibility("private");
                setNewServerTemplate("blank");
                setServerCreateError("");
                setShowCreateServer(true);
              }}
            >
              + Create Hub
            </button>
            <button type="button" onClick={openServerBrowser}>
              Discover Public Hubs
            </button>
          </div>
        )}

        {!showCreateServer && !showServerBrowser && (
          <button
            type="button"
            style={{ ...authSwitchStyle, marginTop: "12px" }}
            onClick={() => {
              setHubOnboardingSkipped(true);
              try {
                localStorage.setItem(`decave_hub_onboarding_skipped:${currentUser.id}`, "1");
              } catch {}
              setShowHome(true);
            }}
          >
            Skip for now
          </button>
        )}

        {showCreateServer && (
          <CreateHubModal
            name={newServerName}
            onNameChange={setNewServerName}
            visibility={newServerVisibility}
            onVisibilityChange={setNewServerVisibility}
            template={newServerTemplate}
            onTemplateChange={setNewServerTemplate}
            streamerHubsEnabled={streamerHubsEnabled}
            error={serverCreateError}
            busy={creatingServer}
            importSlot={
              <DiscordImportPanel
                preview={discordImportPreview}
                busy={discordImportBusy}
                error={discordImportError}
                onLoad={(value) => void loadDiscordTemplate(value)}
                onClear={() => {
                  setDiscordImportPreview(null);
                  setDiscordImportError("");
                }}
              />
            }
            onCancel={() => setShowCreateServer(false)}
            onCreate={(iconFile) => void createServer(iconFile)}
          />
        )}

        {showServerBrowser && (
          <div style={{ marginTop: "18px", textAlign: "left" }}>
            <h2>Discover Public Hubs</h2>
            <input
              type="text"
              placeholder="Search hubs"
              value={discoverSearch}
              onChange={(event) => setDiscoverSearch(event.target.value)}
            />
            {discoverLoading && <p>Loading public hubs...</p>}
            {discoverError && <p style={errorTextStyle}>{discoverError}</p>}
            {!discoverLoading && filteredDiscoverServers.length === 0 && <p>No public hubs match your search.</p>}
            <div style={{ display: "grid", gap: "10px", marginTop: "14px", maxHeight: "360px", overflowY: "auto" }}>
              {filteredDiscoverServers.map((server) => (
                <div key={server.id} style={discoverServerCardStyle}>
                  <div style={discoverServerIconStyle}>{server.icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong>{server.name}</strong>
                    <div style={memberMutedStyle}>
                      {server.membershipPrivate
                        ? "Membership private"
                        : `${server.memberCount ?? 0} members · ${server.onlineCount ?? 0} online`}{" "}
                      · {server.category ?? "Gaming"}
                    </div>
                    {server.description && <div className="discover-description">{server.description}</div>}
                    {(server.tags ?? []).length > 0 && (
                      <div className="discover-tags">
                        {(server.tags ?? []).map((tag) => (
                          <span key={tag}>{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="modal-primary"
                    disabled={server.joined}
                    onClick={() => void joinPublicServer(server.id)}
                  >
                    {server.joined ? "Joined" : "Join"}
                  </button>
                </div>
              ))}
            </div>
            <div className="modal-buttons">
              <button type="button" className="modal-secondary" onClick={() => setShowServerBrowser(false)}>
                Back
              </button>
              <button type="button" className="modal-secondary" onClick={() => void loadDiscoverServers()}>
                Refresh
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
