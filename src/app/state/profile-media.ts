// Upload progress and errors for the profile avatar and banner.

import { useState } from "react";

export function useProfileMediaState() {
  const [profileAvatarBusy, setProfileAvatarBusy] = useState(false);
  const [profileBannerBusy, setProfileBannerBusy] = useState(false);
  const [profileBannerError, setProfileBannerError] = useState("");

  return {
    profileAvatarBusy,
    setProfileAvatarBusy,
    profileBannerBusy,
    setProfileBannerBusy,
    profileBannerError,
    setProfileBannerError,
  };
}

export type ProfileMediaState = ReturnType<typeof useProfileMediaState>;
