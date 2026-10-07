// Asks the owner for an authenticator or recovery code before a protected admin operation.

import type { Dispatch, SetStateAction } from "react";
import { Icon } from "../../components/Icon";
import type { AdminActions } from "../actions/admin";

type Props = {
  ownerLoginChallengeToken: string;
  ownerLoginMfaCode: string;
  setOwnerLoginMfaCode: Dispatch<SetStateAction<string>>;
  ownerLoginMfaBusy: boolean;
  adminActions: AdminActions;
};

export function OwnerSecurityDialog({
  ownerLoginChallengeToken,
  ownerLoginMfaCode,
  setOwnerLoginMfaCode,
  ownerLoginMfaBusy,
  adminActions,
}: Props) {
  return (
    <div className="modal-overlay" onClick={adminActions.cancelOwnerSecurityOperation}>
      <div className="modal dc-owner-security-modal" onClick={(event) => event.stopPropagation()}>
        <span className="ds-kicker">
          <Icon name="shield" size="sm" /> Owner security
        </span>
        <h2>Confirm owner security action</h2>
        <p>
          {ownerLoginChallengeToken
            ? "Enter your authenticator or recovery code to finish fresh authentication."
            : "Owner authentication is in progress."}
        </p>
        {ownerLoginChallengeToken && (
          <>
            <label className="ds-field">
              Authenticator or recovery code
              <input
                className="ds-input"
                value={ownerLoginMfaCode}
                onChange={(event) => setOwnerLoginMfaCode(event.target.value)}
                autoComplete="one-time-code"
                disabled={ownerLoginMfaBusy}
              />
            </label>
            <button
              type="button"
              className="ds-btn ds-btn-primary"
              disabled={ownerLoginMfaBusy || !ownerLoginMfaCode.trim()}
              onClick={() => void adminActions.submitOwnerMfaLogin()}
            >
              Verify code
            </button>
          </>
        )}
        <button type="button" className="ds-btn" onClick={adminActions.cancelOwnerSecurityOperation}>
          Cancel
        </button>
      </div>
    </div>
  );
}
