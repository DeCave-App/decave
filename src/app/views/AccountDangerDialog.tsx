// Confirmation dialog for the dangerous account actions (delete or lock).

import type { Dispatch, SetStateAction, MutableRefObject } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation(["common", "hub", "chat"]);
  return (
    <div className="modal-overlay" onClick={accountActions.closeAccountDangerDialog}>
      <div className="modal dc-account-danger-modal" onClick={(event) => event.stopPropagation()}>
        <div className="dc-account-danger-icon">
          <Icon name={accountDangerAction === "delete" ? "trash" : "lock"} />
        </div>
        <h2>
          {accountDangerAction === "delete"
            ? t("common.account.danger.deleteTitle")
            : t("common.account.danger.disableTitle")}
        </h2>
        <p>
          {accountDangerAction === "delete"
            ? t("common.account.danger.deleteBody")
            : t("common.account.danger.disableBody")}
        </p>
        <input
          className="ds-input"
          type="password"
          value={dangerPassword}
          disabled={securityBusy}
          onChange={(event) => setDangerPassword(event.target.value)}
          placeholder={t("common.account.currentPassword")}
          autoComplete="current-password"
          autoFocus
        />
        {ownerLoginChallengeToken && accountDangerOperationRef.current && (
          <>
            <label className="ds-field">
              {t("common.account.mfaCodeLabel")}
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
              {t("common.actions.verifyCode")}
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
            {t("common.actions.cancel")}
          </button>
          <button
            type="button"
            className="ds-btn ds-btn-danger"
            disabled={securityBusy || !dangerPassword}
            onClick={() => void accountActions.runAccountDangerAction(accountDangerAction)}
          >
            {securityBusy
              ? t("common.status.confirming")
              : accountDangerAction === "delete"
                ? t("common.actions.delete")
                : t("common.actions.disable")}
          </button>
        </div>
      </div>
    </div>
  );
}
