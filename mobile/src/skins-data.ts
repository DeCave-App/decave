// Skin definitions. Kept free of app imports so the theme can read them at
// startup; names and descriptions are read from the catalogs when shown.

import i18next from "i18next";

export type SkinId =
  | "neon"
  | "nebula"
  | "arctic"
  | "crimson"
  | "royal"
  | "pearl"
  | "obsidian";

export type Palette = {
  bg: string;
  panel: string;
  panel2: string;
  nav: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  accentSoft: string;
  /** Selected buttons, tabs and pills under white text, when `accent` is too pale for that. */
  fill?: string;
};

export type SkinDefinition = {
  id: SkinId;
  name: string;
  description: string;
  palette: Palette;
  /** Accent used in Light mode, dark enough to read on light surfaces. */
  lightAccent: string;
};

export const SKINS: SkinDefinition[] = [
  {
    id: "neon",
    lightAccent: "#7C3AED",
    get name() {
      return i18next.t("settings.mobile.skins.neon.name");
    },
    get description() {
      return i18next.t("settings.mobile.skins.neon.description");
    },
    palette: {
      bg: "#09080D",
      panel: "#14121B",
      panel2: "#1B1825",
      nav: "#14111D",
      border: "rgba(255,255,255,.08)",
      text: "#ECEAF2",
      muted: "#A29DB2",
      accent: "#A78BFA",
      accentSoft: "rgba(139,92,246,.22)",
    },
  },
  {
    id: "nebula",
    lightAccent: "#0B7C99",
    get name() {
      return i18next.t("settings.appearance.skins.nebula.name");
    },
    get description() {
      return i18next.t("settings.mobile.skins.nebula.description");
    },
    palette: {
      bg: "#070B16",
      panel: "#0D1425",
      panel2: "#111A2D",
      nav: "#0A1020",
      border: "rgba(130,150,190,.20)",
      text: "#EEF4FF",
      muted: "#8D9AB0",
      accent: "#5FE1FF",
      accentSoft: "rgba(95,225,255,.12)",
    },
  },
  {
    id: "arctic",
    lightAccent: "#0A6FA8",
    get name() {
      return i18next.t("settings.appearance.skins.arctic.name");
    },
    get description() {
      return i18next.t("settings.mobile.skins.arctic.description");
    },
    palette: {
      bg: "#061019",
      panel: "#0A1824",
      panel2: "#0E2230",
      nav: "#081722",
      border: "rgba(112,205,255,.20)",
      text: "#F1FAFF",
      muted: "#8EA7B8",
      accent: "#67D8FF",
      accentSoft: "rgba(103,216,255,.13)",
    },
  },
  {
    id: "crimson",
    lightAccent: "#C42A45",
    get name() {
      return i18next.t("settings.appearance.skins.crimson.name");
    },
    get description() {
      return i18next.t("settings.mobile.skins.crimson.description");
    },
    palette: {
      bg: "#11080B",
      panel: "#1A0D12",
      panel2: "#241117",
      nav: "#160B10",
      border: "rgba(255,104,128,.19)",
      text: "#FFF2F4",
      muted: "#B0989F",
      accent: "#FF6E83",
      accentSoft: "rgba(255,110,131,.13)",
    },
  },
  {
    id: "royal",
    lightAccent: "#8636DB",
    get name() {
      return i18next.t("settings.appearance.skins.royal.name");
    },
    get description() {
      return i18next.t("settings.mobile.skins.royal.description");
    },
    palette: {
      bg: "#0B0715",
      panel: "#130C22",
      panel2: "#1A1130",
      nav: "#10091D",
      border: "rgba(176,129,255,.21)",
      text: "#F7F1FF",
      muted: "#A596BA",
      accent: "#B982FF",
      accentSoft: "rgba(185,130,255,.13)",
    },
  },
  {
    id: "pearl",
    lightAccent: "#4A5A70",
    get name() {
      return i18next.t("settings.appearance.skins.pearl.name");
    },
    get description() {
      return i18next.t("settings.mobile.skins.pearl.description");
    },
    palette: {
      bg: "#11151B",
      panel: "#181E26",
      panel2: "#202833",
      nav: "#151B22",
      border: "rgba(218,229,242,.18)",
      text: "#F7FAFD",
      muted: "#AAB5C1",
      accent: "#DDEBFF",
      accentSoft: "rgba(221,235,255,.11)",
      fill: "#5A7190",
    },
  },
  {
    id: "obsidian",
    lightAccent: "#2F3540",
    get name() {
      return i18next.t("settings.appearance.skins.obsidian.name");
    },
    get description() {
      return i18next.t("settings.mobile.skins.obsidian.description");
    },
    palette: {
      bg: "#050607",
      panel: "#0B0D10",
      panel2: "#111419",
      nav: "#080A0C",
      border: "rgba(190,201,216,.16)",
      text: "#F2F5F8",
      muted: "#858E99",
      accent: "#BFCBDA",
      accentSoft: "rgba(191,203,218,.10)",
      fill: "#59616F",
    },
  },
];

export const SKIN_STORAGE_KEY = "decave_mobile_skin_v2";

export function isSkinId(value: string | null): value is SkinId {
  return SKINS.some((skin) => skin.id === value);
}
