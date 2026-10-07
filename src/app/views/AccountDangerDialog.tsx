// Confirmation dialog for the dangerous account actions (delete or lock).

import type { Dispatch, SetStateAction, MutableRefObject } from "react";
import { Icon } from "../../components/Icon";
import type { AdminActions } from "../actions/admin";
import type { AccountActions } from "../actions/account";

type Props = {
  securityNotice: string;
  securityBusy: boolean;
  dangerPassword: string;
  setDangerPassword: Dispatch<SetStateAction<string>>;
  accountDangerAction: "disable" | "delete";
  accountDangerOperationRef: MutableRefObject<{
    accountId: string;
    controller: AbortController;
    mutationStarted: boolean;
  } | null>;
  ownerLoginChallengeToken: string;
  ownerLoginMfaCode: string;
  setOwnerLoginMfaCode: Dispatch<SetStateAction<string>>;
  ownerLoginMfaBusy: boolean;
  adminActions: AdminActions;
  accountActions: AccountActions;
};

export function AccountDangerDialog({
  securityNotice,
  securityBusy,
  dangerPassword,
  setDangerPassword,
  accountDangerAction,
  accountDangerOperationRef,
  ownerLoginChallengeToken,
  ownerLoginMfaCode,
  setOwnerLoginMfaCode,
  ownerLoginMfaBusy,
  adminActions,
  accountActions,
}: Props) {
  return (
    <div className="modal-overlay" onClick={accountActions.closeAccountDangerDialog}>
      <div className="modal dc-account-danger-modal" onClick={(event) => event.stopPropagation()}>
        <div className="dc-account-danger-icon">
          <Icon name={accountDangerAction === "delete" ? "trash" : "lock"} />
        </div>
        <h2>{accountDangerAction === "delete" ? "Delete account" : "Disable account"}</h2>
        <p>
          {accountDangerAction === "delete"
            ? "Your account will be scheduled for permanent deletion after 30 days. You must transfer ownership of every Hub you own before deletion can be scheduled. Sign in before the deletion date to cancel."
            : "Your account and every active session will be disabled. Signing in again reactivates it."}
        </p>
        <input
          className="ds-input"
          type="password"
          value={dangerPassword}
          disabled={securityBusy}
          onChange={(event) => setDangerPassword(event.target.value)}
          placeholder="Current password"
          autoComplete="current-password"
          autoFocus
        />
        {ownerLoginChallengeToken && accountDangerOperationRef.current && (
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
        {securityNotice && (
          <p className="ds-notice danger" role="alert">
            {securityNotice}
          </p>
        )}
        <div className="modal-actions ds-modal-actions">
          <button type="button" className="ds-btn" onClick={accountActions.closeAccountDangerDialog}>
            Cancel
          </button>
          <button
            type="button"
            className="ds-btn ds-btn-danger"
            disabled={securityBusy || !dangerPassword}
            onClick={() => void accountActions.runAccountDangerAction(accountDangerAction)}
          >
            {securityBusy ? "Confirming…" : accountDangerAction === "delete" ? "Delete" : "Disable"}
          </button>
        </div>
      </div>
    </div>
  );
}
