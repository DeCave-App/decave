// The Create a poll dialog opened from the Hub or DM composer.

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
  return (
    <div className="modal-overlay" onClick={() => setShowPollComposer(null)}>
      <div className="modal dc-poll-composer" onClick={(event) => event.stopPropagation()}>
        <span className="ds-kicker">New poll</span>
        <h2>Create a poll</h2>
        <p>Ask a question and add between 2 and 8 choices.</p>
        <label>
          Question
          <input
            className="ds-input"
            value={pollQuestion}
            onChange={(event) => setPollQuestion(event.target.value)}
            maxLength={180}
            autoFocus
            placeholder="What should we play tonight?"
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
                placeholder={`Option ${index + 1}`}
              />
              {pollOptions.length > 2 && (
                <button
                  type="button"
                  className="ds-btn ds-btn-ghost ds-icon-btn"
                  aria-label={`Remove option ${index + 1}`}
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
            Add option
          </button>
        )}
        <div className="modal-buttons ds-modal-actions">
          <button type="button" className="ds-btn" onClick={() => setShowPollComposer(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="ds-btn ds-btn-primary"
            disabled={!pollQuestion.trim() || pollOptions.filter((item) => item.trim()).length < 2}
            onClick={hubChat.submitPoll}
          >
            Post Poll
          </button>
        </div>
      </div>
    </div>
  );
}
