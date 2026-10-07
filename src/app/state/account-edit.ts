// Inputs and progress of the account edit dialog (username, email,
// password changes).

import { useState } from "react";

export function useAccountEditState() {
  const [changePasswordCurrentInput, setChangePasswordCurrentInput] = useState("");
  const [changePasswordNewInput, setChangePasswordNewInput] = useState("");
  const [changePasswordConfirmInput, setChangePasswordConfirmInput] = useState("");
  const [changePasswordNotice, setChangePasswordNotice] = useState("");
  const [changePasswordBusy, setChangePasswordBusy] = useState(false);
  const [accountEditValue, setAccountEditValue] = useState("");
  const [accountEditPassword, setAccountEditPassword] = useState("");
  const [accountEditMfaCode, setAccountEditMfaCode] = useState("");
  const [accountEditBusy, setAccountEditBusy] = useState(false);
  const [accountEditNotice, setAccountEditNotice] = useState("");

  return {
    changePasswordCurrentInput,
    setChangePasswordCurrentInput,
    changePasswordNewInput,
    setChangePasswordNewInput,
    changePasswordConfirmInput,
    setChangePasswordConfirmInput,
    changePasswordNotice,
    setChangePasswordNotice,
    changePasswordBusy,
    setChangePasswordBusy,
    accountEditValue,
    setAccountEditValue,
    accountEditPassword,
    setAccountEditPassword,
    accountEditMfaCode,
    setAccountEditMfaCode,
    accountEditBusy,
    setAccountEditBusy,
    accountEditNotice,
    setAccountEditNotice,
  };
}

export type AccountEditState = ReturnType<typeof useAccountEditState>;
