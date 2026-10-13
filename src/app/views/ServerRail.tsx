// Left rail: DeCave brand and the primary navigation (Home, Hubs, DMs, Friends).

import { useTranslation } from "react-i18next";
import type { Dispatch, SetStateAction } from "react";
import decaveMark from "../../assets/decave-mark-reference.png";
import { Icon } from "../../components/Icon";
import type { AccountUser } from "../types";
import type { PageNavigation } from "../actions/page-navigation";

type Props = {
  currentUser: AccountUser;
  showSettings: boolean;
  platformOwnerActive: boolean;
  showAdminDashboard: boolean;
  effectiveStreamerMode: boolean;
  showHome: boolean;
  showServerBrowser: boolean;
  showSquadFinder: boolean;
  showSocial: boolean;
  socialView: "dm" | "friends";
  setShowFeedback: Dispatch<SetStateAction<boolean>>;
  setFeedbackContact: Dispatch<SetStateAction<string>>;
  setFeedbackNotice: Dispatch<SetStateAction<string>>;
  openServerBrowser: () => void;
  closePrimaryTransientOverlays: () => void;
  openAdminDashboard: () => void;
  dmUnreadTotal: number;
  pageNavigation: PageNavigation;
};

export function ServerRail({
  currentUser,
  showSettings,
  platformOwnerActive,
  showAdminDashboard,
  effectiveStreamerMode,
  showHome,
  showServerBrowser,
  showSquadFinder,
  showSocial,
  socialView,
  setShowFeedback,
  setFeedbackContact,
  setFeedbackNotice,
  openServerBrowser,
  closePrimaryTransientOverlays,
  openAdminDashboard,
  dmUnreadTotal,
  pageNavigation,
}: Props) {
  const { t } = useTranslation(["common", "hub", "chat"]);
  const {
    openSettings,
    openHomeWorkspace,
    openDirectMessagesWorkspace,
    openFriendsWorkspace,
    openSquadFinderWorkspace,
  } = pageNavigation;
  return (
    <aside className="server-bar">
      <div
        className="vadrion-rail-brand"
        title="DeCave"
        style={{
          width: "66px",
          height: "66px",
          minWidth: "66px",
          minHeight: "66px",
          flex: "0 0 66px",
          margin: "6px auto 2px",
          padding: "2px",
          display: "grid",
          placeItems: "center",
          overflow: "visible",
          boxSizing: "border-box",
          background: "transparent",
          border: 0,
          boxShadow: "none",
        }}
      >
        <img
          src={decaveMark}
          alt="DeCave"
          draggable={false}
          style={{
            width: "60px",
            height: "60px",
            maxWidth: "60px",
            maxHeight: "60px",
            display: "block",
            objectFit: "contain",
            imageRendering: "auto",
            background: "transparent",
            filter: "none",
            transform: "none",
          }}
        />
      </div>

      <nav
        aria-label={t("common.rail.label")}
        className="dc-primary-navigation"
        style={{
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "10px",
          padding: "14px 0 12px",
        }}
      >
        <button
          type="button"
          title={t("common.rail.homeTitle")}
          onClick={openHomeWorkspace}
          className={showHome ? "dc-rail-page-button active" : "dc-rail-page-button"}
          aria-current={showHome ? "page" : undefined}
          data-primary-nav="home"
        >
          <span className="dc-rail-icon" aria-hidden="true">
            <Icon name="home" size="xl" />
          </span>
          <span className="dc-rail-label">{t("common.rail.home")}</span>
        </button>

        <button
          type="button"
          title={t("common.bottomBar.directMessages")}
          onClick={openDirectMessagesWorkspace}
          className={showSocial && socialView === "dm" ? "dc-rail-page-button active" : "dc-rail-page-button"}
          aria-current={showSocial && socialView === "dm" ? "page" : undefined}
          data-primary-nav="dms"
        >
          <span className="dc-rail-icon" aria-hidden="true">
            <Icon name="message" size="xl" />
          </span>
          <span className="dc-rail-label">{t("common.rail.dms")}</span>
          {dmUnreadTotal > 0 && (
            <b title={t("common.rail.dmUnread", { count: dmUnreadTotal })} className="dc-rail-badge">
              {dmUnreadTotal > 99 ? "99+" : dmUnreadTotal}
            </b>
          )}
        </button>

        <button
          type="button"
          title={t("common.rail.friendsTitle")}
          onClick={openFriendsWorkspace}
          className={showSocial && socialView === "friends" ? "dc-rail-page-button active" : "dc-rail-page-button"}
          aria-current={showSocial && socialView === "friends" ? "page" : undefined}
          data-primary-nav="friends"
        >
          <span className="dc-rail-icon" aria-hidden="true">
            <Icon name="users" size="xl" />
          </span>
          <span className="dc-rail-label">{t("common.rail.friends")}</span>
        </button>

        <button
          type="button"
          title={t("common.rail.squadTitle")}
          onClick={openSquadFinderWorkspace}
          className={showSquadFinder ? "dc-rail-page-button active" : "dc-rail-page-button"}
          aria-current={showSquadFinder ? "page" : undefined}
          data-primary-nav="squad-finder"
        >
          <span className="dc-rail-icon" aria-hidden="true">
            <Icon name="gamepad" size="xl" />
          </span>
          <span className="dc-rail-label">{t("common.rail.squad")}</span>
        </button>

        <button
          type="button"
          title={t("common.bottomBar.discoverHubs")}
          onClick={openServerBrowser}
          className={showServerBrowser ? "dc-rail-page-button active" : "dc-rail-page-button"}
          aria-current={showServerBrowser ? "page" : undefined}
          data-primary-nav="discover"
        >
          <span className="dc-rail-icon" aria-hidden="true">
            <Icon name="compass" size="xl" />
          </span>
          <span className="dc-rail-label">{t("common.rail.discover")}</span>
        </button>

        {platformOwnerActive && (
          <button
            type="button"
            title={t("common.rail.adminTitle")}
            onClick={openAdminDashboard}
            className={showAdminDashboard ? "dc-rail-page-button active" : "dc-rail-page-button"}
            aria-current={showAdminDashboard ? "page" : undefined}
            data-primary-nav="admin"
          >
            <span className="dc-rail-icon" aria-hidden="true">
              <Icon name="shield" size="xl" />
            </span>
            <span className="dc-rail-label">{t("common.rail.admin")}</span>
          </button>
        )}
      </nav>

      <button
        type="button"
        title={t("common.rail.feedbackTitle")}
        onClick={() => {
          closePrimaryTransientOverlays();
          setFeedbackNotice("");
          setFeedbackContact(effectiveStreamerMode ? "" : (currentUser.email ?? ""));
          setShowFeedback(true);
        }}
        className="dc-rail-page-button dc-rail-feedback-button"
        data-primary-nav="feedback"
      >
        <span className="dc-rail-icon" aria-hidden="true">
          <Icon name="bulb" size="xl" />
        </span>
        <span className="dc-rail-label">{t("common.rail.feedback")}</span>
      </button>

      <button
        type="button"
        title={t("common.rail.settingsTitle")}
        onClick={openSettings}
        className={
          showSettings
            ? "dc-rail-page-button dc-rail-settings-button active"
            : "dc-rail-page-button dc-rail-settings-button"
        }
        aria-current={showSettings ? "page" : undefined}
        data-primary-nav="settings"
      >
        <span className="dc-rail-icon" aria-hidden="true">
          <Icon name="settings" size="xl" />
        </span>
        <span className="dc-rail-label">{t("common.rail.settings")}</span>
      </button>
    </aside>
  );
}
