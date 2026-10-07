// Requests to the DeCave Worker. The browser session lives in a Secure HttpOnly
// cookie, so requests carry credentials instead of an Authorization header.

import { HTTP_URL } from "./env";

export const authorizedFetch = async (url: string, init: RequestInit = {}) => {
  return fetch(url, {
    ...init,
    credentials: "include",
    headers: new Headers(init.headers),
  });
};

export const fetchWsToken = async (): Promise<string> => {
  const response = await fetch(`${HTTP_URL}/api/auth/ws-token`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) return "";
  const data = (await response.json()) as { wsToken?: string };
  return data.wsToken ?? "";
};
