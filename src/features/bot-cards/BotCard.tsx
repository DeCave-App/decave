// A builder-bot message in a Hub room: BOT badge, text, optional card with
// buttons or a select, and the "Only you can see this" private notice.
// Card content is untrusted: plain text only, https links only, and no
// external image loads (there is no proxy for arbitrary images), so a card
// image is offered as an "Open image" link, unless it is a Hub's own uploaded
// artwork on this DeCave server, which is shown inline.

import { useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  cardButtons,
  cardFields,
  cardSelect,
  cardTextParts,
  formFromResponse,
  interactionBody,
  safeCardLink,
  hubArtworkUrl,
  type BotForm,
  type MessageBot,
} from "../../../shared/bots/card-view";
import { apiErrorText } from "../shared/apiErrorText";
import { BotFormModal } from "./BotFormModal";
import "./bot-cards.css";

type Props = {
  messageId: string;
  roomId: number;
  bot: MessageBot;
  card: Record<string, unknown> | null | undefined;
  privateNotice?: boolean;
  /** The message text, already rendered by the chat's rich-text renderer. */
  body: ReactNode;
  baseUrl: string;
  authorizedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  /** False when the chat's author row already names the bot. */
  showHead?: boolean;
};

/** BOT badge with the bot's colour as a small dot (any colour stays readable). */
export function BotBadge({ bot }: { bot: Pick<MessageBot, "color"> }) {
  const { t } = useTranslation(["bots"]);
  return (
    <span className="bot-badge">
      {bot.color ? <i className="bot-badge-dot" style={{ background: bot.color }} aria-hidden="true" /> : null}
      {t("bots.card.badge")}
    </span>
  );
}

function CardText({ text }: { text: unknown }) {
  return (
    <>
      {cardTextParts(text).map((part, index) =>
        part.kind === "link" ? (
          <a key={index} href={part.value} target="_blank" rel="noreferrer noopener">
            {part.value}
          </a>
        ) : (
          part.value
        ),
      )}
    </>
  );
}

export function BotCard({
  messageId,
  roomId,
  bot,
  card,
  privateNotice,
  body,
  baseUrl,
  authorizedFetch,
  showHead = true,
}: Props) {
  const { t } = useTranslation(["bots"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<BotForm | null>(null);
  const [selected, setSelected] = useState("");
  const triggerRef = useRef<HTMLElement | null>(null);

  const buttons = cardButtons(card);
  const select = cardSelect(card);
  const fields = cardFields(card);
  const imageLink = safeCardLink(card?.imageUrl);
  const inlineImage = imageLink ? hubArtworkUrl(imageLink, baseUrl) : null;
  const title = typeof card?.title === "string" ? card.title : "";
  const text = typeof card?.text === "string" ? card.text : "";
  const accent = typeof card?.color === "string" && /^#[0-9a-fA-F]{6}$/.test(card.color) ? card.color : undefined;

  const interact = async (customId: string, value?: string) => {
    if (busy) return;
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setBusy(true);
    setError("");
    try {
      const response = await authorizedFetch(`${baseUrl}/api/rooms/${roomId}/bot-interactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(interactionBody(messageId, customId, value)),
      });
      const data: unknown = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(apiErrorText(data, t("bots.card.noAnswerStatus", { status: response.status })));
        return;
      }
      const next = formFromResponse(data, t("bots.card.form.untitled"));
      if (next) setForm(next);
    } catch {
      setError(t("bots.card.noAnswer"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={privateNotice ? "bot-message private" : "bot-message"}>
      {showHead ? (
        <div className="bot-message-head">
          {bot.avatarEmoji ? <span aria-hidden="true">{bot.avatarEmoji}</span> : null}
          <BotBadge bot={bot} />
          <strong>{bot.name}</strong>
          {privateNotice ? <span className="bot-private-label">{t("bots.card.privateNotice")}</span> : null}
        </div>
      ) : privateNotice ? (
        <span className="bot-private-label">{t("bots.card.privateNotice")}</span>
      ) : null}
      <div className="bot-message-text">{body}</div>
      {card ? (
        <div className="bot-card" style={accent ? { borderLeftColor: accent } : undefined}>
          {title ? <strong className="bot-card-title">{title}</strong> : null}
          {text ? (
            <p className="bot-card-text">
              <CardText text={text} />
            </p>
          ) : null}
          {fields.length ? (
            <dl className="bot-card-fields">
              {fields.map((field, index) => (
                <div key={index}>
                  <dt>{field.name}</dt>
                  <dd>
                    <CardText text={field.value} />
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
          {inlineImage ? (
            <img className="bot-card-image" src={inlineImage} alt="" loading="lazy" referrerPolicy="no-referrer" />
          ) : imageLink ? (
            <a className="bot-card-image-link" href={imageLink} target="_blank" rel="noreferrer noopener">
              {t("bots.card.openImage")}
            </a>
          ) : null}
          {buttons.length ? (
            <div className="bot-card-buttons">
              {buttons.map((button) => (
                <button
                  key={button.customId}
                  type="button"
                  className={`bot-card-button ${button.style}`}
                  disabled={busy}
                  onClick={() => void interact(button.customId)}
                >
                  {button.label}
                </button>
              ))}
            </div>
          ) : null}
          {select ? (
            <select
              className="bot-card-select"
              aria-label={t("bots.card.chooseOption")}
              disabled={busy}
              value={selected}
              onChange={(event) => {
                const value = event.target.value;
                setSelected(value);
                if (value) void interact(select.customId, value);
              }}
            >
              <option value="">{t("bots.card.choose")}</option>
              {select.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : null}
          {error ? (
            <p className="bot-card-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
      {form ? (
        <BotFormModal
          form={form}
          roomId={roomId}
          baseUrl={baseUrl}
          authorizedFetch={authorizedFetch}
          onClose={() => setForm(null)}
          returnFocus={triggerRef.current}
        />
      ) : null}
    </div>
  );
}
