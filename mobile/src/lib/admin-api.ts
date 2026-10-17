// Platform owner admin calls (/api/admin/*), the same ones web's admin
// dashboard and Trust & Safety queue make. Writes that change other accounts
// carry the 10-minute owner re-auth token in X-DeCave-Owner-Reauth.

import { t } from "i18next";
import { apiErrorText, apiFetch, type ApiErrorBody } from "./api";

export type OwnerReauth = { token: string; expiresAt: number } | null;

export class AdminApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function createAdminApi(token: string, reauth: OwnerReauth) {
  const headers = (json: boolean): Record<string, string> => ({
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(reauth && reauth.expiresAt > Date.now() ? { "X-DeCave-Owner-Reauth": reauth.token } : {}),
  });
  const call = async <T>(path: string, init: { method?: string; body?: unknown } = {}, fallback = t("chat.actions.admin.loadFailed")): Promise<T> => {
    const response = await apiFetch(
      path,
      {
        method: init.method ?? "GET",
        cache: "no-store",
        headers: headers(init.body !== undefined),
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      },
      token,
    );
    const data = (await response.json().catch(() => ({}))) as T & ApiErrorBody;
    if (!response.ok) throw new AdminApiError(response.status, apiErrorText(data, fallback));
    return data;
  };
  return { call };
}

export type AdminApi = ReturnType<typeof createAdminApi>;

/** Platform owner check: the server answers from the account's own row. */
export async function isPlatformOwner(token: string): Promise<boolean> {
  try {
    const response = await apiFetch("/api/admin/platform-status", { cache: "no-store" }, token);
    if (!response.ok) return false;
    const data = (await response.json().catch(() => ({}))) as { platformRole?: string };
    return data.platformRole === "owner";
  } catch {
    return false;
  }
}

/** Unlocks privileged owner actions for 10 minutes with the current password and an MFA or recovery code. */
export async function ownerReauth(token: string, currentPassword: string, mfaCode: string): Promise<{ token: string; expiresAt: number }> {
  const response = await apiFetch(
    "/api/admin/security/reauth",
    { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword, mfaCode }) },
    token,
  );
  const data = (await response.json().catch(() => ({}))) as { reauthToken?: string; expiresInSeconds?: number } & ApiErrorBody;
  if (!response.ok || typeof data.reauthToken !== "string" || !data.reauthToken || data.reauthToken.length > 2048 || data.expiresInSeconds !== 600)
    throw new Error(apiErrorText(data, t("chat.actions.admin.unlockFirst")));
  return { token: data.reauthToken, expiresAt: Date.now() + data.expiresInSeconds * 1000 };
}
