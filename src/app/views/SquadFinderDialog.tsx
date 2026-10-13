// Find a Squad: search for players for a game, see matches, join or leave.

import { squadValueLabel } from "./squadLabels";
import { useTranslation } from "react-i18next";
import type { Dispatch, SetStateAction } from "react";
import { Icon } from "../../components/Icon";
import type { SquadSearch } from "../types";
import { SQUAD_LANGUAGE_OPTIONS } from "../constants";
import { UserAvatar } from "../components/UserAvatar";
import type { SquadSearchActions } from "../actions/squad-search";

type Props = {
  setShowSquadFinder: Dispatch<SetStateAction<boolean>>;
  squadGame: string;
  setSquadGame: Dispatch<SetStateAction<string>>;
  squadGames: string[];
  squadGameSuggestion: string;
  setSquadGameSuggestion: Dispatch<SetStateAction<string>>;
  squadPlatform: string;
  setSquadPlatform: Dispatch<SetStateAction<string>>;
  squadLanguage: string;
  setSquadLanguage: Dispatch<SetStateAction<string>>;
  squadRegion: string;
  setSquadRegion: Dispatch<SetStateAction<string>>;
  squadMicrophone: boolean;
  setSquadMicrophone: Dispatch<SetStateAction<boolean>>;
  squadCurrent: SquadSearch | null;
  squadMatches: SquadSearch[];
  squadBusy: boolean;
  squadNotice: string;
  joinSquadMatch: (match: SquadSearch) => Promise<void>;
  squadSearch: SquadSearchActions;
};

export function SquadFinderDialog({
  setShowSquadFinder,
  squadGame,
  setSquadGame,
  squadGames,
  squadGameSuggestion,
  setSquadGameSuggestion,
  squadPlatform,
  setSquadPlatform,
  squadLanguage,
  setSquadLanguage,
  squadRegion,
  setSquadRegion,
  squadMicrophone,
  setSquadMicrophone,
  squadCurrent,
  squadMatches,
  squadBusy,
  squadNotice,
  joinSquadMatch,
  squadSearch,
}: Props) {
  const { t } = useTranslation(["common", "hub", "chat"]);
  const { loadSquadMatches, suggestSquadGame, startSquadSearch, cancelSquadSearch } = squadSearch;
  return (
    <div className="modal-overlay squad-finder-overlay" onClick={() => setShowSquadFinder(false)}>
      <div className="modal squad-finder-modal" onClick={(event) => event.stopPropagation()}>
        <header className="ds-page-header squad-finder-head">
          <div className="ds-page-header-copy">
            <span className="ds-kicker">{t("common.rail.squad")}</span>
            <h2>{t("common.squad.title")}</h2>
            <p>{t("common.squad.lead")}</p>
          </div>
          <div className="ds-page-header-actions">
            <button
              type="button"
              className="ds-btn ds-btn-ghost ds-icon-btn"
              onClick={() => setShowSquadFinder(false)}
              aria-label={t("common.actions.close")}
              title={t("common.actions.close")}
            >
              <Icon name="close" />
            </button>
          </div>
        </header>
        <div className="squad-finder-fields">
          <label>
            <span>{t("common.squad.game")}</span>
            <select
              className="ds-input"
              value={squadGame}
              onChange={(event) => setSquadGame(event.target.value)}
              disabled={Boolean(squadCurrent)}
            >
              {squadGames.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            <span>{t("common.squad.platformLabel")}</span>
            <select
              className="ds-input"
              value={squadPlatform}
              onChange={(event) => setSquadPlatform(event.target.value)}
              disabled={Boolean(squadCurrent)}
            >
              {["PC", "PlayStation", "Xbox", "Mobile"].map((value) => (
                <option key={value} value={value}>
                  {squadValueLabel("platform", value)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t("common.squad.languageLabel")}</span>
            <select
              className="ds-input"
              value={squadLanguage}
              onChange={(event) => setSquadLanguage(event.target.value)}
              disabled={Boolean(squadCurrent)}
            >
              {SQUAD_LANGUAGE_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {squadValueLabel("language", value)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t("common.squad.regionLabel")}</span>
            <select
              className="ds-input"
              value={squadRegion}
              onChange={(event) => setSquadRegion(event.target.value)}
              disabled={Boolean(squadCurrent)}
            >
              {["Europe", "North America", "South America", "Asia", "Oceania", "Middle East", "Africa"].map((value) => (
                <option key={value} value={value}>
                  {squadValueLabel("region", value)}
                </option>
              ))}
            </select>
          </label>
          <label className="squad-mic-field">
            <span>{t("common.squad.micRequired")}</span>
            <div className="ds-tabs squad-mic-options" role="group" aria-label={t("common.squad.micRequired")}>
              <button
                type="button"
                className={squadMicrophone ? "ds-tab active" : "ds-tab"}
                aria-pressed={squadMicrophone}
                disabled={Boolean(squadCurrent)}
                onClick={() => setSquadMicrophone(true)}
              >
                {t("common.squad.yes")}
              </button>
              <button
                type="button"
                className={!squadMicrophone ? "ds-tab active" : "ds-tab"}
                aria-pressed={!squadMicrophone}
                disabled={Boolean(squadCurrent)}
                onClick={() => setSquadMicrophone(false)}
              >
                {t("common.squad.no")}
              </button>
            </div>
          </label>
        </div>
        <div className="squad-game-suggestion">
          <div>
            <strong>{t("common.squad.suggestTitle")}</strong>
            <span>{t("common.squad.suggestHint")}</span>
          </div>
          <input
            className="ds-input"
            value={squadGameSuggestion}
            onChange={(event) => setSquadGameSuggestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void suggestSquadGame();
            }}
            maxLength={60}
            placeholder={t("common.squad.suggestPlaceholder")}
          />
          <button
            type="button"
            className="ds-btn"
            disabled={squadBusy || !squadGameSuggestion.trim()}
            onClick={() => void suggestSquadGame()}
          >
            {t("common.squad.submit")}
          </button>
        </div>
        <div className="squad-finder-actions">
          {!squadCurrent && (
            <button
              type="button"
              className="ds-btn ds-btn-primary ds-btn-lg squad-start-search"
              disabled={squadBusy}
              onClick={() => void startSquadSearch()}
            >
              <Icon name="search" />
              {squadBusy ? t("common.squad.starting") : t("common.squad.start")}
            </button>
          )}
          {squadCurrent && (
            <button type="button" className="ds-btn" disabled={squadBusy} onClick={() => void loadSquadMatches()}>
              <Icon name="refresh" />
              {t("common.squad.refresh")}
            </button>
          )}
          {squadNotice && <span className="ds-notice">{squadNotice}</span>}
        </div>
        {squadCurrent && (
          <div className="squad-search-live">
            <i />
            <span>{t("common.squad.running")}</span>
            <small>
              {t(
                squadCurrent.microphoneRequired ? "common.squad.currentMicRequired" : "common.squad.currentMicOptional",
                {
                  game: squadCurrent.game,
                  platform: squadValueLabel("platform", squadCurrent.platform),
                  language: squadValueLabel("language", squadCurrent.language),
                  region: squadValueLabel("region", squadCurrent.region),
                },
              )}
            </small>
            <button
              type="button"
              className="ds-btn ds-btn-sm ds-btn-danger squad-cancel-search"
              disabled={squadBusy}
              onClick={() => void cancelSquadSearch()}
            >
              {squadBusy ? t("common.squad.cancelling") : t("common.squad.cancel")}
            </button>
          </div>
        )}
        <div className="ds-list squad-match-list">
          {squadCurrent && squadMatches.length === 0 && (
            <div className="ds-empty squad-empty">
              <span className="ds-empty-icon">
                <Icon name="users" />
              </span>
              <h3>{t("common.squad.emptyTitle")}</h3>
              <p>{t("common.squad.emptyHint")}</p>
            </div>
          )}
          {squadMatches.map((match) => (
            <div className="ds-row ds-row-boxed squad-match-card" key={match.groupId || match.id}>
              <UserAvatar
                username={match.owner?.username || t("common.rail.squad")}
                avatarUrl={match.owner?.avatarUrl}
              />
              <div className="ds-row-copy">
                <strong className="ds-row-title">
                  {match.owner?.username || t("common.squad.gameSquad", { game: match.game })}
                </strong>
                <span className="ds-row-sub">
                  {t("common.squad.matchPlayers", {
                    members: match.memberCount,
                    platform: squadValueLabel("platform", match.platform),
                    region: squadValueLabel("region", match.region),
                  })}
                </span>
                <small className="ds-row-sub">
                  {t(match.microphoneRequired ? "common.squad.matchMicRequired" : "common.squad.matchMicOptional", {
                    language: squadValueLabel("language", match.language),
                  })}
                </small>
              </div>
              <button
                type="button"
                className="ds-btn ds-btn-sm ds-btn-primary"
                disabled={squadBusy}
                onClick={() => void joinSquadMatch(match)}
              >
                {t("common.squad.join")}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
