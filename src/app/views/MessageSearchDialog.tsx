// Search the messages of the current Hub.

import { useTranslation } from "react-i18next";
import type { Dispatch, SetStateAction } from "react";
import { Icon } from "../../components/Icon";
import type { Channel, ChatMessage } from "../types";
import { formatTimestamp } from "../../i18n/format";
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
  const { t } = useTranslation(["common", "hub", "chat"]);
  return (
    <div className="modal-overlay" onClick={() => hubPanels.setShowMessageSearch(false)}>
      <div className="modal v19-search" onClick={(event) => event.stopPropagation()}>
        <header className="ds-page-header">
          <div className="ds-page-header-copy">
            <span className="ds-kicker">{t("chat.messageSearch.kicker")}</span>
            <h2>{t("chat.messageSearch.title", { room: currentChannel.name })}</h2>
          </div>
          <div className="ds-page-header-actions">
            <button
              type="button"
              className="ds-btn ds-btn-ghost ds-icon-btn"
              aria-label={t("common.actions.close")}
              title={t("common.actions.close")}
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
              aria-label={t("chat.messageSearch.placeholder")}
              value={messageSearchQuery}
              onChange={(event) => setMessageSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void hubChat.searchMessages();
              }}
              placeholder={t("chat.messageSearch.placeholder")}
              autoFocus
            />
          </label>
          <button type="button" className="ds-btn ds-btn-primary" onClick={() => void hubChat.searchMessages()}>
            {t("common.actions.search")}
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
