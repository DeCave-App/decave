// Hub artwork size hints and errors (shared/hub-media-specs.ts) in the UI language.

import {
  hubMediaDimensionProblem,
  hubMediaHintText,
  type HubMediaKind,
  type HubMediaText,
} from "../../../shared/hub-media-specs";
import { i18next } from "../../i18n/index.ts";

const translate = (key: string, params: Record<string, number | string>): string =>
  (i18next.t as unknown as (key: string, params: Record<string, number | string>) => string)(key, params);

export const hubMediaHintMessage = (kind: Exclude<HubMediaKind, "icon">): string => {
  const hint: HubMediaText = hubMediaHintText(kind);
  return translate(hint.key, hint.params);
};

/** The size error for an image, or null when its size is acceptable. */
export function hubMediaDimensionMessage(kind: HubMediaKind, width: number, height: number): string | null {
  const problem = hubMediaDimensionProblem(kind, width, height);
  return problem ? translate(`errors.${problem.code}`, problem.params) : null;
}
