// Translation for voice code outside React components: t() in the UI language at
// the moment a status or error message is set.

import type { TFunction } from "i18next";
import { i18next } from "../i18n";

export const t = ((...args: unknown[]) =>
  (i18next.t as unknown as (...params: unknown[]) => string)(...args)) as unknown as TFunction<["common", "voice"]>;
