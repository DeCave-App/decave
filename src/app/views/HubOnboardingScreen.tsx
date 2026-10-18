// First-run screen for accounts with no Hubs yet: create a Hub or join a public one.

import { useTranslation } from "react-i18next";
import { hubCategoryText } from "../../i18n/hubCategory";
import type { Dispatch, SetStateAction } from "react";
import type { HubTemplateId } from "../../../shared/hub-templates";
import { CreateHubModal } from "../../features/create-hub/CreateHubModal";
import type { DiscordImportPreview } from "../../../shared/discord-template";
import type { ServerVisibility, DiscoverServer, AccountUser, AppSkin } from "../types";
import { Icon } from "../../components/Icon";
import { DeCaveBrand } from "../components/DeCaveBrand";
import { DiscordImportPanel } from "../components/DiscordImportPanel";
import "../../features/onboarding/onboarding.css";
import { discoverServerCardStyle, discoverServerIconStyle, errorTextStyle, memberMutedStyle } from "../inline-styles";

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
  const skipToHome = () => {
    setHubOnboardingSkipped(true);
    try {
      localStorage.setItem(`decave_hub_onboarding_skipped:${currentUser.id}`, "1");
    } catch {}
    setShowHome(true);
  };
  return (
    <div className="username-screen vadrion-auth-screen" data-skin={displaySkin}>
      <div className="username-card vadrion-empty-card hob-card">
        <DeCaveBrand />
        <h1>{t("hub.onboarding.title")}</h1>
        <p>{t("hub.onboarding.lead")}</p>

        {!showCreateServer && !showServerBrowser && (
          <>
            <div className="hob-choices">
              <button
                type="button"
                className="hob-choice hob-choice-primary"
                onClick={() => {
                  setNewServerName("");
                  setNewServerVisibility("private");
                  setNewServerTemplate("blank");
                  setServerCreateError("");
                  setShowCreateServer(true);
                }}
              >
                <span className="hob-choice-icon">
                  <Icon name="castle" size="xl" />
                </span>
                <strong>{t("hub.onboarding.createTitle")}</strong>
                <span className="hob-choice-body">{t("hub.onboarding.createBody")}</span>
                <span className="hob-choice-cta">
                  {t("hub.onboarding.createCta")}
                  <Icon name="chevron-right" size="sm" />
                </span>
              </button>
              <button type="button" className="hob-choice" onClick={openServerBrowser}>
                <span className="hob-choice-icon">
                  <Icon name="compass" size="xl" />
                </span>
                <strong>{t("hub.onboarding.discoverTitle")}</strong>
                <span className="hob-choice-body">{t("hub.onboarding.discoverBody")}</span>
                <span className="hob-choice-cta">
                  {t("hub.onboarding.discoverCta")}
                  <Icon name="chevron-right" size="sm" />
                </span>
              </button>
              <button type="button" className="hob-choice" onClick={skipToHome}>
                <span className="hob-choice-icon">
                  <Icon name="users" size="xl" />
                </span>
                <strong>{t("hub.onboarding.friendsTitle")}</strong>
                <span className="hob-choice-body">{t("hub.onboarding.friendsBody")}</span>
                <span className="hob-choice-cta">
                  {t("hub.onboarding.friendsCta")}
                  <Icon name="chevron-right" size="sm" />
                </span>
              </button>
            </div>

            <p className="hob-explainer">
              <Icon name="lock" size="sm" />
              <span>{t("hub.onboarding.explainer")}</span>
            </p>

            <button type="button" className="hob-skip" onClick={skipToHome}>
              {t("hub.onboarding.skip")}
            </button>
          </>
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
