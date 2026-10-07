// Friends page: friend list, requests and adding friends.

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
  return (
    <div className="dcf-grid">
      <section className="dcf-main">
        <div className="dcf-main-head">
          <div className="ds-tabs" role="tablist" aria-label="Friend filters">
            {(
              [
                ["online", `Online ${friends.filter((friend) => friend.online === true).length}`],
                ["all", `All ${friends.length}`],
                ["pending", `Pending ${incomingFriendRequests.length + outgoingFriendRequests.length}`],
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
              placeholder="Search friends"
              aria-label="Search friends"
            />
          </label>
        </div>

        {friendListFilter === "pending" ? (
          incomingFriendRequests.length + outgoingFriendRequests.length === 0 ? (
            <div className="ds-empty">
              <div className="ds-empty-icon">
                <Icon name="user-plus" />
              </div>
              <h3>No pending requests</h3>
              <p>Requests you send or receive show up here.</p>
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
                  <small className="dcf-sub">Wants to be friends</small>
                  <div className="dcf-actions">
                    <button
                      type="button"
                      className="ds-btn ds-btn-primary ds-btn-sm"
                      onClick={() => void socialAction(user.id, "accept")}
                    >
                      <Icon name="check" size="sm" />
                      Accept
                    </button>
                    <button
                      type="button"
                      className="ds-btn ds-btn-ghost ds-btn-sm"
                      onClick={() => void socialAction(user.id, "reject")}
                    >
                      Ignore
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
                  <small className="dcf-sub">Request sent</small>
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
                ? "No friends yet"
                : friendListFilter === "online" && !friendListSearch.trim()
                  ? "Nobody is online right now"
                  : "No friends match"}
            </h3>
            <p>
              {friends.length === 0
                ? "Share your DeCave ID or add someone using theirs."
                : friendListFilter === "online" && !friendListSearch.trim()
                  ? "Switch to All to see everyone."
                  : "Try a different name or filter."}
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
                    Message
                  </button>
                  <span className="dc-friend-actions" data-friend-actions="true">
                    <button
                      type="button"
                      className="ds-btn ds-btn-ghost ds-icon-btn ds-btn-sm"
                      title="More friend actions"
                      aria-label={`More actions for ${user.username}`}
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
                          Copy DeCave ID
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
                          Unfriend…
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
          <div className="dcf-label">Your DeCave ID</div>
          <div className="dcf-id">
            <span title={currentUser.id}>{currentUser.id}</span>
            <button type="button" className="ds-btn ds-btn-sm" onClick={() => void copyMyDecaveId()}>
              <Icon name="copy" size="sm" />
              Copy
            </button>
          </div>
          <small className="dcf-hint">Share it so friends can add you.</small>
        </div>

        <div className="dcf-side-block">
          <label className="dcf-label" htmlFor="dcf-add-input">
            Add a friend
          </label>
          <input
            id="dcf-add-input"
            className="ds-input"
            value={friendIdInput}
            onChange={(event) => setFriendIdInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !friendIdBusy) void addFriendByDecaveId();
            }}
            placeholder="Paste their DeCave ID"
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
            {friendIdBusy ? "Sending…" : "Send request"}
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
            <div className="dcf-label">Requests · {incomingFriendRequests.length}</div>
            {incomingFriendRequests.map((user) => (
              <div className="dcf-request" key={user.id}>
                <UserAvatar username={user.username} avatarUrl={user.avatarUrl} />
                <span className="dcf-request-name" title={user.username}>
                  {user.username}
                </span>
                <button
                  type="button"
                  className="ds-btn ds-btn-primary ds-icon-btn ds-btn-sm"
                  title="Accept"
                  aria-label={`Accept ${user.username}`}
                  onClick={() => void socialAction(user.id, "accept")}
                >
                  <Icon name="check" />
                </button>
                <button
                  type="button"
                  className="ds-btn ds-btn-ghost ds-icon-btn ds-btn-sm"
                  title="Decline"
                  aria-label={`Decline ${user.username}`}
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
