// Confirms removing a friend.

import type { Dispatch, SetStateAction } from "react";
import type { SocialUser } from "../types";

type Props = {
  friendRemovalConfirm: SocialUser;
  setFriendRemovalConfirm: Dispatch<SetStateAction<SocialUser | null>>;
  confirmFriendRemoval: () => Promise<void>;
};

export function RemoveFriendDialog({ friendRemovalConfirm, setFriendRemovalConfirm, confirmFriendRemoval }: Props) {
  return (
    <div className="modal-overlay" onClick={() => setFriendRemovalConfirm(null)}>
      <div className="modal friend-remove-confirm" onClick={(event) => event.stopPropagation()}>
        <div className="friend-remove-icon">◇</div>
        <div className="friend-remove-copy">
          <div className="social-kicker">REMOVE FRIEND</div>
          <h2>Remove {friendRemovalConfirm.username}?</h2>
          <p>
            They will be removed from your friends list. Your existing private message history stays saved, but you will
            need to become friends again before sending new private messages.
          </p>
        </div>
        <div className="modal-buttons">
          <button type="button" className="modal-secondary" onClick={() => setFriendRemovalConfirm(null)}>
            Cancel
          </button>
          <button type="button" className="friend-remove-confirm-button" onClick={() => void confirmFriendRemoval()}>
            Remove Friend
          </button>
        </div>
      </div>
    </div>
  );
}
