// Inputs of the sign-in, registration and password reset forms.

import { useState } from "react";

export function useAuthFormState() {
  const [usernameInput, setUsernameInput] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [confirmPasswordInput, setConfirmPasswordInput] = useState("");
  const [birthDateInput, setBirthDateInput] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [staySignedIn, setStaySignedIn] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [loginMfaKind, setLoginMfaKind] = useState<"owner" | "user">("owner");

  return {
    usernameInput,
    setUsernameInput,
    emailInput,
    setEmailInput,
    passwordInput,
    setPasswordInput,
    confirmPasswordInput,
    setConfirmPasswordInput,
    birthDateInput,
    setBirthDateInput,
    termsAccepted,
    setTermsAccepted,
    staySignedIn,
    setStaySignedIn,
    authBusy,
    setAuthBusy,
    loginMfaKind,
    setLoginMfaKind,
  };
}

export type AuthFormState = ReturnType<typeof useAuthFormState>;
