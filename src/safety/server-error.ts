// The message for a failed API call: the server's error (translated from its code
// when the catalog knows it) or, when the server sent none, the screen's own text.

import { apiErrorMessage, type ApiErrorBody } from "../i18n/apiError";

export function serverErrorOr(data: ApiErrorBody | null | undefined, fallback: string): string {
  if (!data?.code && !data?.error) return fallback;
  return apiErrorMessage(data, "common.unknown");
}
