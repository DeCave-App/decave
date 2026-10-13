// Asks a signed-in user to confirm their age before they can continue.

import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";

type Props = {
  ageGateBirthDate: string;
  setAgeGateBirthDate: Dispatch<SetStateAction<string>>;
  ageGateNotice: string;
  ageGateBusy: boolean;
  confirmAgeGate: () => Promise<void>;
};

export function AgeGateDialog({
  ageGateBirthDate,
  setAgeGateBirthDate,
  ageGateNotice,
  ageGateBusy,
  confirmAgeGate,
}: Props) {
  const { t } = useTranslation(["common", "hub", "chat"]);
  return (
    <div className="modal-overlay dc-age-gate-overlay" onClick={(event) => event.stopPropagation()}>
      <div className="modal dc-age-gate-card" role="dialog" aria-modal="true" aria-labelledby="dc-age-gate-title">
        <div className="dc-safety-kicker ds-kicker">{t("common.ageGate.kicker")}</div>
        <h2 id="dc-age-gate-title">{t("common.ageGate.title")}</h2>
        <p>{t("common.ageGate.body")}</p>
        <label className="ds-field">
          {t("common.ageGate.birthDate")}
          <input
            className="ds-input"
            type="date"
            value={ageGateBirthDate}
            onChange={(event) => setAgeGateBirthDate(event.target.value)}
            max={new Date().toISOString().slice(0, 10)}
            autoFocus
          />
        </label>
        {ageGateNotice && (
          <div className="ds-notice danger" role="alert">
            {ageGateNotice}
          </div>
        )}
        <button
          type="button"
          className="ds-btn ds-btn-primary"
          onClick={() => void confirmAgeGate()}
          disabled={ageGateBusy || !ageGateBirthDate}
        >
          {ageGateBusy ? t("common.status.checking") : t("common.actions.continue")}
        </button>
      </div>
    </div>
  );
}
