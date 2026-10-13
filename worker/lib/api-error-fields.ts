// An apiError response that also carries extra top-level fields, such as the
// `field` a validation error is about or the `path` that was not found.

import { apiError, json, type ErrorCode } from "./http";

/** apiError(code, status, params) plus `fields` merged into the JSON body. */
export async function apiErrorWithFields(
  code: ErrorCode,
  status: number,
  fields: Record<string, unknown>,
  params?: Record<string, string | number>,
): Promise<Response> {
  const body = (await apiError(code, status, params).json()) as Record<string, unknown>;
  return json({ ...body, ...fields }, status);
}
