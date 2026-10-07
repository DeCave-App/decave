// Asks a signed-in user to confirm their age before they can continue.

import type { Dispatch, SetStateAction } from "react";

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
  return (
    <div className="modal-overlay dc-age-gate-overlay" onClick={(event) => event.stopPropagation()}>
      <div className="modal dc-age-gate-card" role="dialog" aria-modal="true" aria-labelledby="dc-age-gate-title">
        <div className="dc-safety-kicker ds-kicker">WELCOME TO DECAVE</div>
        <h2 id="dc-age-gate-title">Confirm your age</h2>
        <p>
          DeCave is available to people aged 13 and older. Choose your birth date to finish setting up your account. We
          keep only an age band and the verification time, not the exact date.
        </p>
        <label className="ds-field">
          Birth date
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
          {ageGateBusy ? "Checking…" : "Continue"}
        </button>
      </div>
    </div>
  );
}
