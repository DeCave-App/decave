import Constants from "expo-constants";
import i18next from "i18next";
import { apiErrorText, type ApiErrorBody } from "./api-error";

const configured =
  process.env.EXPO_PUBLIC_DECAVE_API ||
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined);

export const API_BASE = (configured || "https://app.de-cave.com").replace(/\/$/, "");
export const WS_URL = API_BASE.replace(/^http/, "ws") + "/ws";

export function absoluteMediaUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return `${API_BASE}${value.startsWith("/") ? value : `/${value}`}`;
}

export async function apiFetch(
  path: string,
  init: RequestInit = {},
  token?: string | null,
): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  headers.set("Accept", "application/json");

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });
}

export { apiErrorText, type ApiErrorBody } from "./api-error";

export async function apiJson<T>(
  path: string,
  init: RequestInit = {},
  token?: string | null,
): Promise<T> {
  const response = await apiFetch(path, init, token);
  const data = (await response.json().catch(() => ({}))) as T & ApiErrorBody;
  if (!response.ok) {
    throw new Error(apiErrorText(data, i18next.t("errors.mobile.requestFailed", { status: response.status })));
  }
  return data;
}
