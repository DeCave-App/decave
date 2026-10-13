// Friends page: friend list, requests and adding friends.

import { useTranslation } from "react-i18next";
import type { Dispatch, SetStateAction } from "react";
import { Icon } from "../../components/Icon";
import type { AccountUser, SocialUser } from "../types";
import { presenceLabel, presenceColor } from "../user-display";
import { UserAvatar } from "../components/UserAvatar";

type Props = {
  currentUser: AccountUser;
  friends: SocialUser[];
  friendListSearch: string;
  setFriendListSearch: Dispatch<SetStateAction<string>>;
  friendListFilter: "online" | "all" | "offline" | "pending";
  setFriendListFilter: Dispatch<SetStateAction<"online" | "all" | "offline" | "pending">>;
  friendActionsUserId: string | null;
  setFriendActionsUserId: Dispatch<SetStateAction<string | null>>;
  incomingFriendRequests: SocialUser[];
  outgoingFriendRequests: SocialUser[];
  friendIdInput: string;
  setFriendIdInput: Dispatch<SetStateAction<string>>;
  friendIdNotice: string;
  friendIdBusy: boolean;
  socialAction: (userId: string, action: "request" | "accept" | "reject" | "remove") => Promise<void>;
  addFriendByDecaveId: () => Promise<void>;
  copyMyDecaveId: () => Promise<void>;
  askToRemoveFriend: (user: SocialUser) => void;
  openDirectMessage: (user: SocialUser) => Promise<void>;
  visibleFriends: SocialUser[];
};

export function FriendsView({
  currentUser,
  friends,
  friendListSearch,
  setFriendListSearch,
  friendListFilter,
  setFriendListFilter,
  friendActionsUserId,
  setFriendActionsUserId,
  incomingFriendRequests,
  outgoingFriendRequests,
  friendIdInput,
  setFriendIdInput,
  friendIdNotice,
  friendIdBusy,
  socialAction,
  addFriendByDecaveId,
  copyMyDecaveId,
  askToRemoveFriend,
  openDirectMessage,
  visibleFriends,
}: Props) {
  const { t } = useTranslation(["common", "hub", "chat"]);
  return (
    <div className="dcf-grid">
      <section className="dcf-main">
        <div className="dcf-main-head">
          <div className="ds-tabs" role="tablist" aria-label={t("common.friends.filters")}>
            {(
              [
                [
                  "online",
                  t("common.friends.tabOnline", { number: friends.filter((friend) => friend.online === true).length }),
                ],
                ["all", t("common.friends.tabAll", { number: friends.length })],
                [
                  "pending",
                  t("common.friends.tabPending", {
                    number: incomingFriendRequests.length + outgoingFriendRequests.length,
                  }),
                ],
              ] as const
            ).map(([filter, label]) => (
              <button
                key={filter}
                type="button"
                role="tab"
                className="ds-tab"
                aria-selected={friendListFilter === filter}
                onClick={() => setFriendListFilter(filter)}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="ds-search dcf-search">
            <Icon name="search" size="sm" />
            <input
              className="ds-input"
              type="search"
              value={friendListSearch}
              onChange={(event) => setFriendListSearch(event.target.value)}
              placeholder={t("common.friendsSidebar.search")}
              aria-label={t("common.friendsSidebar.search")}
            />
          </label>
        </div>

        {friendListFilter === "pending" ? (
          incomingFriendRequests.length + outgoingFriendRequests.length === 0 ? (
            <div className="ds-empty">
              <div className="ds-empty-icon">
                <Icon name="user-plus" />
              </div>
              <h3>{t("common.friends.noPending")}</h3>
              <p>{t("common.friends.noPendingHint")}</p>
            </div>
          ) : (
            <div className="dcf-cards">
              {incomingFriendRequests.map((user) => (
                <div className="dcf-card is-request" key={`in-${user.id}`}>
                  <span className="dcf-avatar">
                    <UserAvatar username={user.username} avatarUrl={user.avatarUrl} />
                  </span>
                  <strong className="dcf-name" title={user.username}>
                    {user.username}
                  </strong>
                  <small className="dcf-sub">{t("common.friends.wantsToBeFriends")}</small>
                  <div className="dcf-actions">
                    <button
                      type="button"
                      className="ds-btn ds-btn-primary ds-btn-sm"
                      onClick={() => void socialAction(user.id, "accept")}
                    >
                      <Icon name="check" size="sm" />
                      {t("common.actions.accept")}
                    </button>
                    <button
                      type="button"
                      className="ds-btn ds-btn-ghost ds-btn-sm"
                      onClick={() => void socialAction(user.id, "reject")}
                    >
                      {t("common.friends.ignore")}
                    </button>
                  </div>
                </div>
              ))}
              {outgoingFriendRequests.map((user) => (
                <div className="dcf-card" key={`out-${user.id}`}>
                  <span className="dcf-avatar">
                    <UserAvatar username={user.username} avatarUrl={user.avatarUrl} />
                  </span>
                  <strong className="dcf-name" title={user.username}>
                    {user.username}
                  </strong>
                  <small className="dcf-sub">{t("common.friends.requestSent")}</small>
                </div>
              ))}
            </div>
          )
        ) : visibleFriends.length === 0 ? (
          <div className="ds-empty">
            <div className="ds-empty-icon">
              <Icon name="users" />
            </div>
            <h3>
              {friends.length === 0
                ? t("common.friends.emptyTitle")
                : friendListFilter === "online" && !friendListSearch.trim()
                  ? t("common.friends.noneOnlineTitle")
                  : t("common.friends.noMatchTitle")}
            </h3>
            <p>
              {friends.length === 0
                ? t("common.friends.emptyHint")
                : friendListFilter === "online" && !friendListSearch.trim()
                  ? t("common.friends.noneOnlineHint")
                  : t("common.friends.noMatchHint")}
            </p>
          </div>
        ) : (
          <div className="dcf-cards">
            {visibleFriends.map((user) => (
              <div className={`dcf-card${user.online === true ? "" : " is-offline"}`} key={user.id}>
                <span className="dcf-avatar">
                  <UserAvatar username={user.username} avatarUrl={user.avatarUrl} />
                  <span
                    className="dcf-presence"
                    title={presenceLabel(user.status, user.online === true)}
                    style={{ background: presenceColor(user.status, user.online === true) }}
                  />
                </span>
                <strong className="dcf-name" title={user.username}>
                  {user.username}
                </strong>
                <small className="dcf-sub" title={user.activityText || undefined}>
                  {user.online === true && user.activityText
                    ? user.activityText
                    : presenceLabel(user.status, user.online === true)}
                </small>
                <div className="dcf-actions">
                  <button type="button" className="ds-btn ds-btn-sm" onClick={() => void openDirectMessage(user)}>
                    <Icon name="message" size="sm" />
                    {t("chat.newConversation.message")}
                  </button>
                  <span className="dc-friend-actions" data-friend-actions="true">
                    <button
                      type="button"
                      className="ds-btn ds-btn-ghost ds-icon-btn ds-btn-sm"
                      title={t("common.friends.moreActions")}
                      aria-label={t("common.friends.moreActionsFor", { name: user.username })}
                      aria-expanded={friendActionsUserId === user.id}
                      onClick={() => setFriendActionsUserId((current) => (current === user.id ? null : user.id))}
                    >
                      <Icon name="more" />
                    </button>
                    {friendActionsUserId === user.id && (
                      <div className="dc-friend-actions-menu ds-menu">
                        <button
                          type="button"
                          onClick={() => {
                            setFriendActionsUserId(null);
                            navigator.clipboard?.writeText(user.id).catch(() => undefined);
                          }}
                        >
                          <Icon name="copy" size="sm" />
                          {t("common.friends.copyId")}
                        </button>
                        <button
                          type="button"
                          className="danger"
                          onClick={() => {
                            setFriendActionsUserId(null);
                            askToRemoveFriend(user);
                          }}
                        >
                          <Icon name="close" size="sm" />
                          {t("common.friends.unfriend")}
                        </button>
                      </div>
                    )}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <aside className="dcf-side">
        <div className="dcf-side-block">
          <div className="dcf-label">{t("common.friends.yourId")}</div>
          <div className="dcf-id">
            <span title={currentUser.id}>{currentUser.id}</span>
            <button type="button" className="ds-btn ds-btn-sm" onClick={() => void copyMyDecaveId()}>
              <Icon name="copy" size="sm" />
              {t("common.actions.copy")}
            </button>
          </div>
          <small className="dcf-hint">{t("common.friends.yourIdHint")}</small>
        </div>

        <div className="dcf-side-block">
          <label className="dcf-label" htmlFor="dcf-add-input">
            {t("chat.groupMembers.addTitle")}
          </label>
          <input
            id="dcf-add-input"
            className="ds-input"
            value={friendIdInput}
            onChange={(event) => setFriendIdInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !friendIdBusy) void addFriendByDecaveId();
            }}
            placeholder={t("common.friends.pasteId")}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            className="ds-btn ds-btn-primary ds-btn-block dc-send-friend-request"
            disabled={friendIdBusy || !friendIdInput.trim()}
            onClick={() => void addFriendByDecaveId()}
          >
            <Icon name="user-plus" size="sm" />
            {friendIdBusy ? t("common.status.sending") : t("common.friends.sendRequest")}
          </button>
          {friendIdNotice && (
            <div className={`ds-notice ${friendIdNotice.toLowerCase().includes("sent") ? "ok" : ""}`} role="status">
              {friendIdNotice.toLowerCase().includes("sent") && <Icon name="check" size="sm" />}
              <span>{friendIdNotice}</span>
            </div>
          )}
        </div>

        {incomingFriendRequests.length > 0 && (
          <div className="dcf-side-block">
            <div className="dcf-label">
              {t("common.friends.requestsCount", { number: incomingFriendRequests.length })}
            </div>
            {incomingFriendRequests.map((user) => (
              <div className="dcf-request" key={user.id}>
                <UserAvatar username={user.username} avatarUrl={user.avatarUrl} />
                <span className="dcf-request-name" title={user.username}>
                  {user.username}
                </span>
                <button
                  type="button"
                  className="ds-btn ds-btn-primary ds-icon-btn ds-btn-sm"
                  title={t("common.actions.accept")}
                  aria-label={t("common.friends.acceptUser", { name: user.username })}
                  onClick={() => void socialAction(user.id, "accept")}
                >
                  <Icon name="check" />
                </button>
                <button
                  type="button"
                  className="ds-btn ds-btn-ghost ds-icon-btn ds-btn-sm"
                  title={t("common.actions.decline")}
                  aria-label={t("common.friends.declineUser", { name: user.username })}
                  onClick={() => void socialAction(user.id, "reject")}
                >
                  <Icon name="close" />
                </button>
              </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}
