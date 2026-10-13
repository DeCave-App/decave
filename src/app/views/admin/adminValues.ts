// Stored account and Hub values the admin dashboard shows (roles, age checks,
// visibility) in the UI language; unknown values are shown as stored.

import { i18next } from "../../../i18n/index.ts";

export type AdminValueKind = "platformRole" | "ageStatus" | "ageBand" | "ageAssuranceMethod" | "visibility";

export function adminValueLabel(kind: AdminValueKind, value: string | null | undefined): string {
  const raw = value ?? "";
  const key = `admin.values.${kind}.${raw}`;
  if (!/^[a-z_]+$/.test(raw) || !i18next.exists(key)) return raw;
  return (i18next.t as unknown as (key: string) => string)(key);
}
