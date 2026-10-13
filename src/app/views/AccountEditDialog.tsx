// Dialog for changing your username, email, phone number or password, confirmed with your password (and second factor if on).

import { useTranslation } from "react-i18next";
import type { Dispatch, SetStateAction } from "react";
import type { AccountEditState } from "../state/account-edit";
import type { AccountActions } from "../actions/account";

type Props = {
  accountEditField: "username" | "email" | "password";
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
  const { t } = useTranslation(["common", "hub", "chat"]);
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
        <div className="social-kicker ds-kicker">{t("common.account.edit.kicker")}</div>
        <h2>
          {accountEditField === "username"
            ? t("common.account.edit.usernameTitle")
            : accountEditField === "email"
              ? t("common.account.edit.emailTitle")
              : t("common.account.edit.passwordTitle")}
        </h2>
        {accountEditField === "username" && <p>{t("common.account.edit.usernameBody")}</p>}
        {accountEditField === "email" && <p>{t("common.account.edit.emailBody")}</p>}
        {accountEditField === "password" ? (
          <div className="dc-account-edit-fields">
            <input
              className="ds-input"
              type="password"
              value={changePasswordCurrentInput}
              onChange={(event) => setChangePasswordCurrentInput(event.target.value)}
              placeholder={t("common.account.currentPassword")}
              autoComplete="current-password"
              autoFocus
            />
            <input
              className="ds-input"
              type="password"
              value={changePasswordNewInput}
              onChange={(event) => setChangePasswordNewInput(event.target.value)}
              placeholder={t("common.account.edit.newPassword")}
              autoComplete="new-password"
            />
            <input
              className="ds-input"
              type="password"
              value={changePasswordConfirmInput}
              onChange={(event) => setChangePasswordConfirmInput(event.target.value)}
              placeholder={t("common.account.edit.confirmPassword")}
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
                  ? t("common.account.edit.newUsername")
                  : accountEditField === "email"
                    ? t("common.account.edit.newEmail")
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
              placeholder={t("common.account.currentPassword")}
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
                placeholder={t("common.account.edit.mfaIfEnabled")}
                aria-label={t("common.account.mfaCodeLabel")}
                autoComplete="one-time-code"
              />
            )}
            {accountEditBusy && ownerLoginChallengeToken && (
              <>
                <p>{t("common.account.edit.verifyBody")}</p>
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
                  placeholder={t("common.account.mfaCodeLabel")}
                  autoComplete="one-time-code"
                  autoFocus
                />
                <button
                  type="button"
                  className="ds-btn ds-btn-primary"
                  disabled={ownerLoginMfaBusy || !ownerLoginMfaCode.trim()}
                  onClick={() => void submitOwnerMfaLogin()}
                >
                  {ownerLoginMfaBusy ? t("common.status.verifying") : t("common.account.edit.verifyButton")}
                </button>
              </>
            )}
            {accountEditNotice && <div className="ds-notice danger">{accountEditNotice}</div>}
          </div>
        )}
        <div className="modal-actions ds-modal-actions">
          <button type="button" className="ds-btn" disabled={changePasswordBusy} onClick={() => closeAccountEditor()}>
            {t("common.actions.cancel")}
          </button>
          <button
            type="button"
            className="ds-btn ds-btn-primary"
            disabled={
              accountEditBusy ||
              changePasswordBusy ||
              (accountEditField !== "password" && (!accountEditPassword || !accountEditValue.trim()))
            }
            onClick={() => (accountEditField === "password" ? void changePassword() : void submitAccountIdentityEdit())}
          >
            {accountEditBusy || changePasswordBusy ? t("common.status.saving") : t("common.actions.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
