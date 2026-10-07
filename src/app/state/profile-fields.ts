// The signed-in user's profile fields as edited in Settings: display name, bio,
// pronouns, status and accent colour.

import { useState } from "react";
import type { PresenceStatus } from "../types";

export function useProfileFieldsState() {
  const [profileBio, setProfileBio] = useState("");
  const [profileStatus, setProfileStatus] = useState<PresenceStatus>("online");
  const [profileStatusText, setProfileStatusText] = useState("");
  const [profileAccent, setProfileAccent] = useState("#7c5cff");
  const [profileDisplayName, setProfileDisplayName] = useState("");
  const [profilePronouns, setProfilePronouns] = useState("");

  return {
    profileBio,
    setProfileBio,
    profileStatus,
    setProfileStatus,
    profileStatusText,
    setProfileStatusText,
    profileAccent,
    setProfileAccent,
    profileDisplayName,
    setProfileDisplayName,
    profilePronouns,
    setProfilePronouns,
  };
}

export type ProfileFieldsState = ReturnType<typeof useProfileFieldsState>;
