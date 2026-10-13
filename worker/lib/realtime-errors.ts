// Error fields for realtime frames ({ type: "ERROR" | "VOICE_ERROR" | ... }) that
// clients translate: the catalog key in `code`, or in `i18nKey` when the frame
// already carries a machine code clients branch on; `message` keeps the English.

import { englishErrorText, type ErrorCode } from "./http";

export type RealtimeErrorFields = {
  code: string;
  i18nKey?: ErrorCode;
  params?: Record<string, string | number>;
  message: string;
};

export function realtimeErrorFields(
  i18nKey: ErrorCode,
  options: { params?: Record<string, string | number>; machineCode?: string } = {},
): RealtimeErrorFields {
  const { params, machineCode } = options;
  return {
    code: machineCode ?? i18nKey,
    ...(machineCode ? { i18nKey } : {}),
    ...(params ? { params } : {}),
    message: englishErrorText(i18nKey, params),
  };
}
