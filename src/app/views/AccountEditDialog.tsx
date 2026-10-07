// Dialog for changing your username, email, phone number or password, confirmed with your password (and second factor if on).

import type { Dispatch, SetStateAction } from "react";
import type { AccountEditState } from "../state/account-edit";
import type { AccountActions } from "../actions/account";

type Props = {
  accountEditField: "username" | "email" | "phone" | "password";
  ownerLoginChallengeToken: string;
  ownerLoginMfaCode: string;
  setOwnerLoginMfaCode: Dispatch<SetStateAction<string>>;
  ownerLoginMfaBusy: boolean;
  submitOwnerMfaLogin: () => Promise<void>;
  accountEdit: AccountEditState;
  accountActions: AccountActions;
};

export function AccountEditDialog({
  accountEditField,
  ownerLoginChallengeToken,
  ownerLoginMfaCode,
  setOwnerLoginMfaCode,
  ownerLoginMfaBusy,
  submitOwnerMfaLogin,
  accountEdit,
  accountActions,
}: Props) {
  const { closeAccountEditor, submitAccountIdentityEdit, changePassword } = accountActions;
  const {
    changePasswordCurrentInput,
    setChangePasswordCurrentInput,
    changePasswordNewInput,
    setChangePasswordNewInput,
    changePasswordConfirmInput,
    setChangePasswordConfirmInput,
    changePasswordNotice,
    changePasswordBusy,
    accountEditValue,
    setAccountEditValue,
    accountEditPassword,
    setAccountEditPassword,
    accountEditMfaCode,
    setAccountEditMfaCode,
    accountEditBusy,
    accountEditNotice,
  } = accountEdit;
  return (
    <div className="modal-overlay" onClick={() => !changePasswordBusy && closeAccountEditor()}>
      <div className="modal dc-account-edit-modal" onClick={(event) => event.stopPropagation()}>
        <div className="social-kicker ds-kicker">ACCOUNT SECURITY</div>
        <h2>
          {accountEditField === "username"
            ? "Change username"
            : accountEditField === "email"
              ? "Change email"
              : accountEditField === "phone"
                ? "Edit phone number"
                : "Change password"}
        </h2>
        {accountEditField === "username" && (
          <p>Your username must be unique across DeCave. After changing it, you cannot change it again for 30 days.</p>
        )}
        {accountEditField === "email" && (
          <p>We will send a verification link to the new email address. The address remains pending until verified.</p>
        )}
        {accountEditField === "phone" && <p>Enter a phone number with country code. Leave it blank to remove it.</p>}
        {accountEditField === "password" ? (
          <div className="dc-account-edit-fields">
            <input
              className="ds-input"
              type="password"
              value={changePasswordCurrentInput}
              onChange={(event) => setChangePasswordCurrentInput(event.target.value)}
              placeholder="Current password"
              autoComplete="current-password"
              autoFocus
            />
            <input
              className="ds-input"
              type="password"
              value={changePasswordNewInput}
              onChange={(event) => setChangePasswordNewInput(event.target.value)}
              placeholder="New password"
              autoComplete="new-password"
            />
            <input
              className="ds-input"
              type="password"
              value={changePasswordConfirmInput}
              onChange={(event) => setChangePasswordConfirmInput(event.target.value)}
              placeholder="Confirm new password"
              autoComplete="new-password"
            />
            {changePasswordNotice && <div className="ds-notice danger">{changePasswordNotice}</div>}
          </div>
        ) : (
          <div className="dc-account-edit-fields">
            <input
              className="ds-input"
              type={accountEditField === "email" ? "email" : "text"}
              disabled={accountEditBusy}
              value={accountEditValue}
              onChange={(event) => setAccountEditValue(event.target.value)}
              placeholder={
                accountEditField === "username"
                  ? "New username"
                  : accountEditField === "email"
                    ? "New email"
                    : "+48123456789"
              }
              autoFocus
            />
            <input
              className="ds-input"
              type="password"
              disabled={accountEditBusy}
              value={accountEditPassword}
              onChange={(event) => setAccountEditPassword(event.target.value)}
              placeholder="Current password"
              autoComplete="current-password"
            />
            {accountEditField === "email" && (
              <input
                className="ds-input"
                type="text"
                inputMode="numeric"
                value={accountEditMfaCode}
                onChange={(event) =>
                  setAccountEditMfaCode(event.target.value.toUpperCase().replace(/\s/g, "").slice(0, 19))
                }
                placeholder="Authenticator or recovery code, if enabled"
                aria-label="Authenticator or recovery code"
                autoComplete="one-time-code"
              />
            )}
            {accountEditBusy && ownerLoginChallengeToken && (
              <>
                <p>Verify this account update with your authenticator or a one-time recovery code.</p>
                <input
                  className="ds-input"
                  type="text"
                  value={ownerLoginMfaCode}
                  onChange={(event) =>
                    setOwnerLoginMfaCode(event.target.value.toUpperCase().replace(/\s/g, "").slice(0, 19))
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void submitOwnerMfaLogin();
                  }}
                  placeholder="Authenticator or recovery code"
                  autoComplete="one-time-code"
                  autoFocus
                />
                <button
                  type="button"
                  className="ds-btn ds-btn-primary"
                  disabled={ownerLoginMfaBusy || !ownerLoginMfaCode.trim()}
                  onClick={() => void submitOwnerMfaLogin()}
                >
                  {ownerLoginMfaBusy ? "Verifying…" : "Verify account update"}
                </button>
              </>
            )}
            {accountEditNotice && <div className="ds-notice danger">{accountEditNotice}</div>}
          </div>
        )}
        <div className="modal-actions ds-modal-actions">
          <button type="button" className="ds-btn" disabled={changePasswordBusy} onClick={() => closeAccountEditor()}>
            Cancel
          </button>
          <button
            type="button"
            className="ds-btn ds-btn-primary"
            disabled={
              accountEditBusy ||
              changePasswordBusy ||
              (accountEditField !== "password" &&
                (!accountEditPassword || (accountEditField !== "phone" && !accountEditValue.trim())))
            }
            onClick={() => (accountEditField === "password" ? void changePassword() : void submitAccountIdentityEdit())}
          >
            {accountEditBusy || changePasswordBusy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
