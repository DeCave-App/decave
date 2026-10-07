// Profile avatar and banner: upload (with size checks) and remove.

import type { Dispatch, SetStateAction } from "react";
import type { AccountUser } from "../types";
import { HTTP_URL } from "../env";
import { MAX_PROFILE_IMAGE_BYTES } from "../constants";
import type { ProfileMediaState } from "../state/profile-media";

export type ProfileMediaActionsDeps = {
  setProfileAvatarError: Dispatch<SetStateAction<string>>;
  authorizedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  setCurrentUserFromResponse: (nextUser: AccountUser) => void;
  profileMedia: ProfileMediaState;
};

/** Called once per render with that render's values. */
export function createProfileMediaActions(deps: ProfileMediaActionsDeps) {
  const { setProfileAvatarError, authorizedFetch, setCurrentUserFromResponse, profileMedia } = deps;
  const { setProfileAvatarBusy, setProfileBannerBusy, setProfileBannerError } = profileMedia;

  const uploadProfileBanner = async (file: File) => {
    setProfileBannerError("");
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setProfileBannerError("Choose a PNG, JPEG or WebP image.");
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      setProfileBannerError("Banner images must be 3 MB or smaller.");
      return;
    }
    setProfileBannerBusy(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () =>
          typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read image."));
        reader.onerror = () => reject(reader.error ?? new Error("Could not read image."));
        reader.readAsDataURL(file);
      });
      const response = await authorizedFetch(`${HTTP_URL}/api/profile/banner`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl: dataUrl }),
      });
      const data = (await response.json().catch(() => ({}))) as { user?: AccountUser; error?: string };
      if (!response.ok || !data.user) {
        setProfileBannerError(data.error || "Could not save the banner.");
        return;
      }
      setCurrentUserFromResponse(data.user);
    } catch {
      setProfileBannerError("Could not upload the banner.");
    } finally {
      setProfileBannerBusy(false);
    }
  };

  const removeProfileBanner = async () => {
    setProfileBannerError("");
    setProfileBannerBusy(true);
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/profile/banner`, { method: "DELETE" });
      const data = (await response.json().catch(() => ({}))) as { user?: AccountUser; error?: string };
      if (!response.ok || !data.user) {
        setProfileBannerError(data.error || "Could not remove the banner.");
        return;
      }
      setCurrentUserFromResponse(data.user);
    } catch {
      setProfileBannerError("Could not remove the banner.");
    } finally {
      setProfileBannerBusy(false);
    }
  };

  const uploadProfileAvatar = async (file: File) => {
    setProfileAvatarError("");

    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setProfileAvatarError("Choose a PNG, JPEG or WebP image.");
      return;
    }
    if (file.size > MAX_PROFILE_IMAGE_BYTES) {
      setProfileAvatarError("Profile images must be 2 MB or smaller.");
      return;
    }

    setProfileAvatarBusy(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () =>
          typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read image."));
        reader.onerror = () => reject(reader.error ?? new Error("Could not read image."));
        reader.readAsDataURL(file);
      });

      const response = await authorizedFetch(`${HTTP_URL}/api/profile/avatar`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl: dataUrl }),
      });
      const data = (await response.json()) as { user?: AccountUser; error?: string };
      if (!response.ok || !data.user) {
        setProfileAvatarError(data.error || "Could not save profile photo.");
        return;
      }
      setCurrentUserFromResponse(data.user);
    } catch (error) {
      console.error("Could not upload profile photo:", error);
      setProfileAvatarError("Could not upload profile photo.");
    } finally {
      setProfileAvatarBusy(false);
    }
  };

  const removeProfileAvatar = async () => {
    setProfileAvatarError("");
    setProfileAvatarBusy(true);
    try {
      const response = await authorizedFetch(`${HTTP_URL}/api/profile/avatar`, {
        method: "DELETE",
      });
      const data = (await response.json()) as { user?: AccountUser; error?: string };
      if (!response.ok || !data.user) {
        setProfileAvatarError(data.error || "Could not remove profile photo.");
        return;
      }
      setCurrentUserFromResponse(data.user);
    } catch (error) {
      console.error("Could not remove profile photo:", error);
      setProfileAvatarError("Could not remove profile photo.");
    } finally {
      setProfileAvatarBusy(false);
    }
  };

  return {
    uploadProfileBanner,
    removeProfileBanner,
    uploadProfileAvatar,
    removeProfileAvatar,
  };
}

export type ProfileMediaActions = ReturnType<typeof createProfileMediaActions>;
