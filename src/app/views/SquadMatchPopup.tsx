// Pops up when Squad Finder finds a match.

import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "../../components/Icon";
import type { SquadSearch } from "../types";
import type { SquadSearchActions } from "../actions/squad-search";

type Props = {
  setShowSquadFinder: Dispatch<SetStateAction<boolean>>;
  squadMatchPopup: SquadSearch;
  setSquadMatchPopup: Dispatch<SetStateAction<SquadSearch | null>>;
  squadSearch: SquadSearchActions;
};

export function SquadMatchPopup({ setShowSquadFinder, squadMatchPopup, setSquadMatchPopup, squadSearch }: Props) {
  const { t } = useTranslation(["common", "hub", "chat"]);
  return (
    <div className="squad-match-popup" role="status">
      <div className="squad-match-popup-icon">
        <Icon name="check" />
      </div>
      <div>
        <strong>{t("common.squadMatch.title")}</strong>
        <span>
          {t("common.squadMatch.players", { members: squadMatchPopup.memberCount, game: squadMatchPopup.game })}
        </span>
      </div>
      <button
        type="button"
        className="ds-btn ds-btn-sm ds-btn-primary"
        onClick={() => {
          setSquadMatchPopup(null);
          setShowSquadFinder(true);
          void squadSearch.loadSquadMatches();
          void squadSearch.loadSquadGames();
        }}
      >
        {t("common.squadMatch.view")}
      </button>
      <button
        type="button"
        className="ds-btn ds-btn-ghost ds-icon-btn ds-btn-sm dismiss"
        aria-label={t("common.actions.dismiss")}
        onClick={() => setSquadMatchPopup(null)}
      >
        <Icon name="close" />
      </button>
    </div>
  );
}
