// Streamer errors clients can translate: a StreamerInputError carrying an
// errors-catalog code, and the JSON body a caught one becomes.

import { streamerInputError, type StreamerInputError } from "../../shared/streamer-mode";
import { errorFields, type ErrorCode, type ErrorFields } from "../lib/http";

/** A StreamerInputError whose message is the code's English text. */
export function streamerError(
  code: ErrorCode,
  status = 400,
  params?: Record<string, string | number>,
): StreamerInputError {
  return streamerInputError(code, params, status);
}

/** { code, params?, error } for a caught StreamerInputError. */
export function streamerErrorBody(error: StreamerInputError): ErrorFields {
  return errorFields(error.code, error.params);
}
