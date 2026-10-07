// Find a Squad: search for players for a game, see matches, join or leave.

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
  const { loadSquadMatches, suggestSquadGame, startSquadSearch, cancelSquadSearch } = squadSearch;
  return (
    <div className="modal-overlay squad-finder-overlay" onClick={() => setShowSquadFinder(false)}>
      <div className="modal squad-finder-modal" onClick={(event) => event.stopPropagation()}>
        <header className="ds-page-header squad-finder-head">
          <div className="ds-page-header-copy">
            <span className="ds-kicker">Squad</span>
            <h2>Find a Squad</h2>
            <p>Matches use game, platform, language, region and microphone requirement.</p>
          </div>
          <div className="ds-page-header-actions">
            <button
              type="button"
              className="ds-btn ds-btn-ghost ds-icon-btn"
              onClick={() => setShowSquadFinder(false)}
              aria-label="Close"
              title="Close"
            >
              <Icon name="close" />
            </button>
          </div>
        </header>
        <div className="squad-finder-fields">
          <label>
            <span>Game</span>
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
            <span>Platform</span>
            <select
              className="ds-input"
              value={squadPlatform}
              onChange={(event) => setSquadPlatform(event.target.value)}
              disabled={Boolean(squadCurrent)}
            >
              {["PC", "PlayStation", "Xbox", "Mobile"].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Language</span>
            <select
              className="ds-input"
              value={squadLanguage}
              onChange={(event) => setSquadLanguage(event.target.value)}
              disabled={Boolean(squadCurrent)}
            >
              {SQUAD_LANGUAGE_OPTIONS.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Region</span>
            <select
              className="ds-input"
              value={squadRegion}
              onChange={(event) => setSquadRegion(event.target.value)}
              disabled={Boolean(squadCurrent)}
            >
              {["Europe", "North America", "South America", "Asia", "Oceania", "Middle East", "Africa"].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="squad-mic-field">
            <span>Microphone required</span>
            <div className="ds-tabs squad-mic-options" role="group" aria-label="Microphone required">
              <button
                type="button"
                className={squadMicrophone ? "ds-tab active" : "ds-tab"}
                aria-pressed={squadMicrophone}
                disabled={Boolean(squadCurrent)}
                onClick={() => setSquadMicrophone(true)}
              >
                Yes
              </button>
              <button
                type="button"
                className={!squadMicrophone ? "ds-tab active" : "ds-tab"}
                aria-pressed={!squadMicrophone}
                disabled={Boolean(squadCurrent)}
                onClick={() => setSquadMicrophone(false)}
              >
                No
              </button>
            </div>
          </label>
        </div>
        <div className="squad-game-suggestion">
          <div>
            <strong>Can’t find your game?</strong>
            <span>Suggest it for review. Approved games are added for everyone.</span>
          </div>
          <input
            className="ds-input"
            value={squadGameSuggestion}
            onChange={(event) => setSquadGameSuggestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void suggestSquadGame();
            }}
            maxLength={60}
            placeholder="Type a game name"
          />
          <button
            type="button"
            className="ds-btn"
            disabled={squadBusy || !squadGameSuggestion.trim()}
            onClick={() => void suggestSquadGame()}
          >
            Submit
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
              {squadBusy ? "Starting…" : "Start Search"}
            </button>
          )}
          {squadCurrent && (
            <button type="button" className="ds-btn" disabled={squadBusy} onClick={() => void loadSquadMatches()}>
              <Icon name="refresh" />
              Refresh matches
            </button>
          )}
          {squadNotice && <span className="ds-notice">{squadNotice}</span>}
        </div>
        {squadCurrent && (
          <div className="squad-search-live">
            <i />
            <span>Search running</span>
            <small>
              {squadCurrent.game} · {squadCurrent.platform} · {squadCurrent.language} · {squadCurrent.region} · Mic{" "}
              {squadCurrent.microphoneRequired ? "required" : "optional"}
            </small>
            <button
              type="button"
              className="ds-btn ds-btn-sm ds-btn-danger squad-cancel-search"
              disabled={squadBusy}
              onClick={() => void cancelSquadSearch()}
            >
              {squadBusy ? "Cancelling…" : "Cancel search"}
            </button>
          </div>
        )}
        <div className="ds-list squad-match-list">
          {squadCurrent && squadMatches.length === 0 && (
            <div className="ds-empty squad-empty">
              <span className="ds-empty-icon">
                <Icon name="users" />
              </span>
              <h3>No compatible squads yet</h3>
              <p>Keep this window open or come back later. Search results refresh automatically.</p>
            </div>
          )}
          {squadMatches.map((match) => (
            <div className="ds-row ds-row-boxed squad-match-card" key={match.groupId || match.id}>
              <UserAvatar username={match.owner?.username || "Squad"} avatarUrl={match.owner?.avatarUrl} />
              <div className="ds-row-copy">
                <strong className="ds-row-title">{match.owner?.username || `${match.game} squad`}</strong>
                <span className="ds-row-sub">
                  {match.memberCount}/4 players · {match.platform} · {match.region}
                </span>
                <small className="ds-row-sub">
                  {match.language} · Microphone {match.microphoneRequired ? "required" : "optional"}
                </small>
              </div>
              <button
                type="button"
                className="ds-btn ds-btn-sm ds-btn-primary"
                disabled={squadBusy}
                onClick={() => void joinSquadMatch(match)}
              >
                Join group
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
