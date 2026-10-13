// Asks the owner for an authenticator or recovery code before a protected admin operation.

import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation(["common", "hub", "chat"]);
  return (
    <div className="modal-overlay" onClick={adminActions.cancelOwnerSecurityOperation}>
      <div className="modal dc-owner-security-modal" onClick={(event) => event.stopPropagation()}>
        <span className="ds-kicker">
          <Icon name="shield" size="sm" /> {t("common.ownerSecurity.kicker")}
        </span>
        <h2>{t("common.ownerSecurity.title")}</h2>
        <p>{ownerLoginChallengeToken ? t("common.ownerSecurity.enterCode") : t("common.ownerSecurity.inProgress")}</p>
        {ownerLoginChallengeToken && (
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
        <button type="button" className="ds-btn" onClick={adminActions.cancelOwnerSecurityOperation}>
          {t("common.actions.cancel")}
        </button>
      </div>
    </div>
  );
}
