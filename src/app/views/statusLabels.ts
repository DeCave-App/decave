// Realtime and voice connection states are kept in English for the app's logic
// ("Connected", "Reconnecting..."); this shows them in the UI language.

import { i18next } from "../../i18n";

export function connectionStatusLabel(status: string): string {
  if (status === "Connected") return i18next.t("common.connection.connected");
  if (status === "Connecting...") return i18next.t("common.connection.connecting");
  if (status === "Reconnecting...") return i18next.t("common.connection.reconnecting");
  if (status === "Disconnected") return i18next.t("common.connection.disconnected");
  return status;
}
