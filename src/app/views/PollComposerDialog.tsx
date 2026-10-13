// The Create a poll dialog opened from the Hub or DM composer.

import { useTranslation } from "react-i18next";
import type { Dispatch, SetStateAction } from "react";
import { Icon } from "../../components/Icon";
import type { HubChatActions } from "../actions/hub-chat";

type Props = {
  setShowPollComposer: Dispatch<SetStateAction<"hub" | "dm" | null>>;
  pollQuestion: string;
  setPollQuestion: Dispatch<SetStateAction<string>>;
  pollOptions: string[];
  setPollOptions: Dispatch<SetStateAction<string[]>>;
  hubChat: HubChatActions;
};

export function PollComposerDialog({
  setShowPollComposer,
  pollQuestion,
  setPollQuestion,
  pollOptions,
  setPollOptions,
  hubChat,
}: Props) {
  const { t } = useTranslation(["common", "hub", "chat"]);
  return (
    <div className="modal-overlay" onClick={() => setShowPollComposer(null)}>
      <div className="modal dc-poll-composer" onClick={(event) => event.stopPropagation()}>
        <span className="ds-kicker">{t("chat.poll.kicker")}</span>
        <h2>{t("chat.poll.title")}</h2>
        <p>{t("chat.poll.lead")}</p>
        <label>
          {t("chat.poll.question")}
          <input
            className="ds-input"
            value={pollQuestion}
            onChange={(event) => setPollQuestion(event.target.value)}
            maxLength={180}
            autoFocus
            placeholder={t("chat.poll.questionPlaceholder")}
          />
        </label>
        <div className="dc-poll-option-editor">
          {pollOptions.map((option, index) => (
            <div key={index}>
              <input
                className="ds-input"
                value={option}
                onChange={(event) =>
                  setPollOptions((current) =>
                    current.map((item, itemIndex) => (itemIndex === index ? event.target.value : item)),
                  )
                }
                maxLength={100}
                placeholder={t("chat.poll.option", { number: index + 1 })}
              />
              {pollOptions.length > 2 && (
                <button
                  type="button"
                  className="ds-btn ds-btn-ghost ds-icon-btn"
                  aria-label={t("chat.poll.removeOption", { number: index + 1 })}
                  onClick={() => setPollOptions((current) => current.filter((_item, itemIndex) => itemIndex !== index))}
                >
                  <Icon name="close" />
                </button>
              )}
            </div>
          ))}
        </div>
        {pollOptions.length < 8 && (
          <button type="button" className="ds-btn" onClick={() => setPollOptions((current) => [...current, ""])}>
            <Icon name="plus" />
            {t("chat.poll.addOption")}
          </button>
        )}
        <div className="modal-buttons ds-modal-actions">
          <button type="button" className="ds-btn" onClick={() => setShowPollComposer(null)}>
            {t("common.actions.cancel")}
          </button>
          <button
            type="button"
            className="ds-btn ds-btn-primary"
            disabled={!pollQuestion.trim() || pollOptions.filter((item) => item.trim()).length < 2}
            onClick={hubChat.submitPoll}
          >
            {t("chat.poll.post")}
          </button>
        </div>
      </div>
    </div>
  );
}
