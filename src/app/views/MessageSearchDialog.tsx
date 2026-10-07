// Search the messages of the current Hub.

import type { Dispatch, SetStateAction } from "react";
import { Icon } from "../../components/Icon";
import type { Channel, ChatMessage } from "../types";
import { formatTimestamp } from "../locale";
import type { HubPanelsState } from "../state/hub-panels";
import type { HubChatActions } from "../actions/hub-chat";

type Props = {
  hubPanels: HubPanelsState;
  messageSearchQuery: string;
  setMessageSearchQuery: Dispatch<SetStateAction<string>>;
  messageSearchResults: ChatMessage[];
  currentChannel: Channel;
  hubChat: HubChatActions;
};

export function MessageSearchDialog({
  hubPanels,
  messageSearchQuery,
  setMessageSearchQuery,
  messageSearchResults,
  currentChannel,
  hubChat,
}: Props) {
  return (
    <div className="modal-overlay" onClick={() => hubPanels.setShowMessageSearch(false)}>
      <div className="modal v19-search" onClick={(event) => event.stopPropagation()}>
        <header className="ds-page-header">
          <div className="ds-page-header-copy">
            <span className="ds-kicker">Message search</span>
            <h2>Search #{currentChannel.name}</h2>
          </div>
          <div className="ds-page-header-actions">
            <button
              type="button"
              className="ds-btn ds-btn-ghost ds-icon-btn"
              aria-label="Close"
              title="Close"
              onClick={() => hubPanels.setShowMessageSearch(false)}
            >
              <Icon name="close" />
            </button>
          </div>
        </header>
        <div className="v19-searchbar">
          <label className="ds-search">
            <Icon name="search" size="sm" />
            <input
              className="ds-input"
              type="search"
              aria-label="Search messages or usernames"
              value={messageSearchQuery}
              onChange={(event) => setMessageSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void hubChat.searchMessages();
              }}
              placeholder="Search messages or usernames"
              autoFocus
            />
          </label>
          <button type="button" className="ds-btn ds-btn-primary" onClick={() => void hubChat.searchMessages()}>
            Search
          </button>
        </div>
        <div className="v19-search-results ds-list">
          {messageSearchResults.map((message) => (
            <div className="ds-row ds-row-boxed" key={message.id}>
              <div className="ds-row-copy">
                <strong className="ds-row-title">
                  {message.username} <small className="ds-row-sub">{formatTimestamp(message.timestamp)}</small>
                </strong>
                <p className="ds-row-sub">{message.text}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
