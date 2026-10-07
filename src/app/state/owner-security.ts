// Platform owner security: the owner role, second factor setup and recovery
// codes, re-authentication before privileged actions, and managing the list of
// platform owners.

import { useState } from "react";
import type { PlatformOwnerSummary } from "../types";

export function useOwnerSecurityState() {
  const [ownerMfaEnabledState, setOwnerMfaEnabledState] = useState(false);
  const [ownerMfaCode, setOwnerMfaCode] = useState("");
  const [ownerMfaNotice, setOwnerMfaNotice] = useState("");
  const [ownerRecoveryCodes, setOwnerRecoveryCodes] = useState<string[]>([]);
  const [platformOwners, setPlatformOwners] = useState<PlatformOwnerSummary[]>([]);
  const [ownerTargetIdentifier, setOwnerTargetIdentifier] = useState("");
  const [ownerManagementNotice, setOwnerManagementNotice] = useState("");

  const [platformOwnerActive, setPlatformOwnerActive] = useState(false);
  const [ownerMfaPassword, setOwnerMfaPassword] = useState("");
  const [ownerMfaSecret, setOwnerMfaSecret] = useState("");
  const [ownerMfaOtpAuth, setOwnerMfaOtpAuth] = useState("");
  const [ownerMfaBusy, setOwnerMfaBusy] = useState(false);
  const [ownerReauthPassword, setOwnerReauthPassword] = useState("");
  const [ownerReauthCode, setOwnerReauthCode] = useState("");
  const [ownerReauthToken, setOwnerReauthToken] = useState("");
  const [ownerReauthExpiresAt, setOwnerReauthExpiresAt] = useState(0);
  const [ownerReauthNotice, setOwnerReauthNotice] = useState("");
  const [ownerManagementBusy, setOwnerManagementBusy] = useState(false);

  return {
    ownerMfaEnabledState,
    setOwnerMfaEnabledState,
    ownerMfaCode,
    setOwnerMfaCode,
    ownerMfaNotice,
    setOwnerMfaNotice,
    ownerRecoveryCodes,
    setOwnerRecoveryCodes,
    platformOwners,
    setPlatformOwners,
    ownerTargetIdentifier,
    setOwnerTargetIdentifier,
    ownerManagementNotice,
    setOwnerManagementNotice,
    platformOwnerActive,
    setPlatformOwnerActive,
    ownerMfaPassword,
    setOwnerMfaPassword,
    ownerMfaSecret,
    setOwnerMfaSecret,
    ownerMfaOtpAuth,
    setOwnerMfaOtpAuth,
    ownerMfaBusy,
    setOwnerMfaBusy,
    ownerReauthPassword,
    setOwnerReauthPassword,
    ownerReauthCode,
    setOwnerReauthCode,
    ownerReauthToken,
    setOwnerReauthToken,
    ownerReauthExpiresAt,
    setOwnerReauthExpiresAt,
    ownerReauthNotice,
    setOwnerReauthNotice,
    ownerManagementBusy,
    setOwnerManagementBusy,
  };
}

export type OwnerSecurityState = ReturnType<typeof useOwnerSecurityState>;
