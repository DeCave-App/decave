// Slash-command autocomplete for the Hub composer, fed by
// GET /api/servers/:hubId/bot-commands (404 while the bot builder is off).

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  commandsFromResponse,
  filterCommands,
  sendsCommandDirectly,
  type BotCommandInfo,
} from "../../../shared/bots/card-view";

/** Commands are refetched when "/" is typed and the list is older than this. */
const COMMANDS_MAX_AGE_MS = 60_000;
/** Hubs whose server answered 404 (no bot builder): not asked again this session. */
const hubsWithoutBuilder = new Set<number>();
import "./bot-cards.css";

/**
 * Commands of a Hub, loaded when the composer text starts with "/" (again
 * once the list is over a minute old, or for another Hub).
 * Returns the suggestions for the current text plus keyboard handling.
 */
export function useBotCommands(
  hubId: number,
  input: string,
  baseUrl: string,
  authorizedFetch: (url: string, init?: RequestInit) => Promise<Response>,
) {
  const [loaded, setLoaded] = useState<{ hubId: number; at: number; commands: BotCommandInfo[] } | null>(null);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState("");
  const wantsCommands = input.startsWith("/");
  // The fetch helper is recreated on every App render; don't refetch for that.
  const fetchRef = useRef(authorizedFetch);
  useEffect(() => {
    fetchRef.current = authorizedFetch;
  }, [authorizedFetch]);

  const loadedRef = useRef(loaded);
  useEffect(() => {
    loadedRef.current = loaded;
  }, [loaded]);

  // Runs when "/" starts the text (or the Hub changes while it does).
  useEffect(() => {
    const current = loadedRef.current;
    if (!wantsCommands || (current?.hubId === hubId && Date.now() - current.at < COMMANDS_MAX_AGE_MS)) return;
    if (hubsWithoutBuilder.has(hubId)) {
      if (current?.hubId !== hubId) setLoaded({ hubId, at: Date.now(), commands: [] });
      return;
    }
    let cancelled = false;
    fetchRef
      .current(`${baseUrl}/api/servers/${hubId}/bot-commands`)
      .then(async (response) => {
        if (response.status === 404) hubsWithoutBuilder.add(hubId);
        return response.ok ? commandsFromResponse(await response.json()) : [];
      })
      .catch(() => [])
      .then((commands) => {
        if (!cancelled) setLoaded({ hubId, at: Date.now(), commands });
      });
    return () => {
      cancelled = true;
    };
  }, [wantsCommands, hubId, baseUrl]);

  const suggestions = loaded?.hubId === hubId && input !== dismissed ? filterCommands(loaded.commands, input) : [];
  const index = Math.min(active, Math.max(suggestions.length - 1, 0));

  /** Handles arrows, Tab/Enter and Escape while suggestions show; true when the key was used. */
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>, choose: (command: BotCommandInfo) => void) => {
    if (!suggestions.length) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index + step + suggestions.length) % suggestions.length);
      return true;
    }
    // An exact command that needs no options is sent as typed.
    if (event.key === "Enter" && !event.shiftKey && loaded && sendsCommandDirectly(loaded.commands, input))
      return false;
    if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
      event.preventDefault();
      choose(suggestions[index]);
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setDismissed(input);
      return true;
    }
    return false;
  };

  return { suggestions, activeIndex: index, setActive, onKeyDown };
}

export function commandInsertText(command: BotCommandInfo) {
  return `/${command.name} `;
}

type Props = {
  suggestions: BotCommandInfo[];
  activeIndex: number;
  onHover: (index: number) => void;
  onChoose: (command: BotCommandInfo) => void;
};

export function BotCommandSuggestions({ suggestions, activeIndex, onHover, onChoose }: Props) {
  const { t } = useTranslation(["bots"]);
  if (!suggestions.length) return null;
  return (
    <ul className="bot-command-suggestions" role="listbox" aria-label={t("bots.card.commands")}>
      {suggestions.map((command, index) => (
        <li key={`${command.botId}:${command.name}`} role="option" aria-selected={index === activeIndex}>
          <button
            type="button"
            className={index === activeIndex ? "active" : ""}
            onMouseEnter={() => onHover(index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onChoose(command)}
          >
            <strong>/{command.name}</strong>
            {command.options.length ? (
              <span className="bot-command-options">
                {command.options.map((option) => (option.required ? `<${option.name}>` : `[${option.name}]`)).join(" ")}
              </span>
            ) : null}
            <small>{command.botName}</small>
          </button>
        </li>
      ))}
    </ul>
  );
}
