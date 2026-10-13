// Squad search values (platform, region, language) are stored in English; these
// show them in the UI language. Values without a translation are shown as stored.

import { i18next } from "../../i18n";

type SquadField = "platform" | "region" | "language";

// The values are data, so their keys are built at runtime and looked up untyped.
const translate = i18next.t as unknown as (key: string) => string;

export function squadValueLabel(field: SquadField, value: string): string {
  const key = `common.squad.${field}.${value.replace(/[^A-Za-z]/g, "")}`;
  return i18next.exists(key) ? translate(key) : value;
}
