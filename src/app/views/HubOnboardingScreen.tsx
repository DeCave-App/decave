// First-run screen for accounts with no Hubs yet: create a Hub or join a public one.

import { useTranslation } from "react-i18next";
import { hubCategoryText } from "../../i18n/hubCategory";
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
  const { t } = useTranslation(["common", "hub", "chat"]);
  return (
    <div className="username-screen vadrion-auth-screen" data-skin={displaySkin}>
      <div className="username-card vadrion-empty-card" style={{ width: "min(760px, 92vw)", maxWidth: "760px" }}>
        <DeCaveBrand />
        <h1>{t("hub.onboarding.title")}</h1>
        <p>{t("hub.onboarding.lead")}</p>

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
              {t("hub.noHubs.create")}
            </button>
            <button type="button" onClick={openServerBrowser}>
              {t("hub.noHubs.discover")}
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
            {t("hub.onboarding.skip")}
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
            <h2>{t("hub.noHubs.discover")}</h2>
            <input
              type="text"
              placeholder={t("hub.onboarding.search")}
              value={discoverSearch}
              onChange={(event) => setDiscoverSearch(event.target.value)}
            />
            {discoverLoading && <p>{t("hub.onboarding.loading")}</p>}
            {discoverError && <p style={errorTextStyle}>{discoverError}</p>}
            {!discoverLoading && filteredDiscoverServers.length === 0 && <p>{t("hub.onboarding.noResults")}</p>}
            <div style={{ display: "grid", gap: "10px", marginTop: "14px", maxHeight: "360px", overflowY: "auto" }}>
              {filteredDiscoverServers.map((server) => (
                <div key={server.id} style={discoverServerCardStyle}>
                  <div style={discoverServerIconStyle}>{server.icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong>{server.name}</strong>
                    <div style={memberMutedStyle}>
                      {server.membershipPrivate
                        ? t("hub.onboarding.cardPrivate", {
                            category:
                              server.category != null
                                ? hubCategoryText(server.category)
                                : t("hub.onboarding.defaultCategory"),
                          })
                        : t("hub.onboarding.card", {
                            count: server.memberCount ?? 0,
                            online: server.onlineCount ?? 0,
                            category:
                              server.category != null
                                ? hubCategoryText(server.category)
                                : t("hub.onboarding.defaultCategory"),
                          })}
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
                    {server.joined ? t("hub.onboarding.joined") : t("common.actions.join")}
                  </button>
                </div>
              ))}
            </div>
            <div className="modal-buttons">
              <button type="button" className="modal-secondary" onClick={() => setShowServerBrowser(false)}>
                {t("common.actions.back")}
              </button>
              <button type="button" className="modal-secondary" onClick={() => void loadDiscoverServers()}>
                {t("common.actions.refresh")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
