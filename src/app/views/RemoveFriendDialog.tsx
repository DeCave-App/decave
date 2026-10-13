// Confirms removing a friend.

import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import type { SocialUser } from "../types";

type Props = {
  friendRemovalConfirm: SocialUser;
  setFriendRemovalConfirm: Dispatch<SetStateAction<SocialUser | null>>;
  confirmFriendRemoval: () => Promise<void>;
};

export function RemoveFriendDialog({ friendRemovalConfirm, setFriendRemovalConfirm, confirmFriendRemoval }: Props) {
  const { t } = useTranslation(["common", "hub", "chat"]);
  return (
    <div className="modal-overlay" onClick={() => setFriendRemovalConfirm(null)}>
      <div className="modal friend-remove-confirm" onClick={(event) => event.stopPropagation()}>
        <div className="friend-remove-icon">◇</div>
        <div className="friend-remove-copy">
          <div className="social-kicker">{t("common.friends.remove.kicker")}</div>
          <h2>{t("common.friends.remove.title", { name: friendRemovalConfirm.username })}</h2>
          <p>{t("common.friends.remove.body")}</p>
        </div>
        <div className="modal-buttons">
          <button type="button" className="modal-secondary" onClick={() => setFriendRemovalConfirm(null)}>
            {t("common.actions.cancel")}
          </button>
          <button type="button" className="friend-remove-confirm-button" onClick={() => void confirmFriendRemoval()}>
            {t("common.friends.remove.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
