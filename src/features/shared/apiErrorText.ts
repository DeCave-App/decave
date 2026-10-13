// Text for a failed API call: the server's error (translated when it sends a
// code), else the caller's own message for that call.

import { apiErrorMessage, type ApiErrorBody } from "../../i18n/apiError.ts";

export function apiErrorText(data: unknown, fallback: string): string {
  const body = (data && typeof data === "object" ? data : {}) as ApiErrorBody;
  const hasCode = typeof body.code === "string" && body.code !== "";
  const hasError = typeof body.error === "string" && body.error !== "";
  return hasCode || hasError ? apiErrorMessage(body, "common.unknown") : fallback;
}
