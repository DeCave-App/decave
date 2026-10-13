// Signed-in device names ("Chrome on Windows · Greece"). The Worker stores and
// sends the English label for older clients, plus these parts so current
// clients can show the name in the UI language.

/** App or browser a session signed in from: code -> English name. */
export const SESSION_DEVICE_APPS = {
  desktop: "DeCave Desktop",
  mobile: "DeCave Mobile",
  edge: "Edge",
  opera: "Opera",
  firefox: "Firefox",
  chrome: "Chrome",
  safari: "Safari",
  browser: "Web browser",
  mobileApp: "Mobile app",
  desktopApp: "Desktop app",
  legacy: "Legacy session",
} as const;

export type SessionDeviceApp = keyof typeof SESSION_DEVICE_APPS;

export const SESSION_DEVICE_OSES = ["Windows", "iOS", "macOS", "Android", "ChromeOS", "Linux"] as const;

export type SessionDeviceOs = (typeof SESSION_DEVICE_OSES)[number];

/** The parts of a device name: app code, operating system ("" if unknown) and two-letter country ("" if unknown). */
export type SessionDevice = { app: SessionDeviceApp; os: SessionDeviceOs | ""; country: string };

/** Apps whose English name is a brand and is never translated. */
export const SESSION_DEVICE_BRAND_APPS: readonly SessionDeviceApp[] = [
  "desktop",
  "mobile",
  "edge",
  "opera",
  "firefox",
  "chrome",
  "safari",
];

const isApp = (value: unknown): value is SessionDeviceApp =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(SESSION_DEVICE_APPS, value);

const isOs = (value: unknown): value is SessionDeviceOs =>
  typeof value === "string" && (SESSION_DEVICE_OSES as readonly string[]).includes(value);

const isCountry = (value: string): boolean => /^[A-Z]{2}$/.test(value) && value !== "XX" && value !== "T1";

/** The parts of a device name, read from a browser or app user agent. */
export function sessionDeviceFromUserAgent(
  userAgent: string,
  client: "web" | "desktop" | "mobile" | string,
  country = "",
): SessionDevice {
  const ua = userAgent || "";
  const os: SessionDeviceOs | "" = /Windows/i.test(ua)
    ? "Windows"
    : /iPhone|iPad|iPod/i.test(ua)
      ? "iOS"
      : /Mac OS X|Macintosh/i.test(ua)
        ? "macOS"
        : /Android/i.test(ua)
          ? "Android"
          : /CrOS/i.test(ua)
            ? "ChromeOS"
            : /Linux/i.test(ua)
              ? "Linux"
              : "";
  const app: SessionDeviceApp =
    client === "desktop" || /Electron|DeCave/i.test(ua)
      ? "desktop"
      : client === "mobile"
        ? "mobile"
        : /Edg\//.test(ua)
          ? "edge"
          : /OPR\/|Opera/.test(ua)
            ? "opera"
            : /Firefox\//.test(ua)
              ? "firefox"
              : /Chrome\//.test(ua)
                ? "chrome"
                : /Safari\//.test(ua)
                  ? "safari"
                  : "browser";
  return { app, os, country: isCountry(country) ? country : "" };
}

/** A country's name in a language, or the code itself when the runtime has no names. */
export function countryName(country: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(country) ?? country;
  } catch {
    return country;
  }
}

/** The English device name the Worker stores and sends as `deviceLabel`. */
export function englishSessionDeviceLabel(device: SessionDevice): string {
  const app = SESSION_DEVICE_APPS[device.app];
  const place = device.country ? countryName(device.country, "en") : "";
  return [device.os ? `${app} on ${device.os}` : app, place].filter(Boolean).join(" · ").slice(0, 80);
}

let englishCountryCodes: Map<string, string> | null = null;

/** Two-letter code for an English country name as englishSessionDeviceLabel writes it. */
function countryCodeForEnglishName(name: string): string {
  if (/^[A-Z]{2}$/.test(name)) return isCountry(name) ? name : "";
  if (!englishCountryCodes) {
    englishCountryCodes = new Map();
    for (let a = 65; a <= 90; a += 1) {
      for (let b = 65; b <= 90; b += 1) {
        const code = String.fromCharCode(a, b);
        if (!isCountry(code)) continue;
        const english = countryName(code, "en");
        if (english !== code && !englishCountryCodes.has(english)) englishCountryCodes.set(english, code);
      }
    }
  }
  return englishCountryCodes.get(name) ?? "";
}

const englishAppCodes = new Map<string, SessionDeviceApp>(
  (Object.entries(SESSION_DEVICE_APPS) as [SessionDeviceApp, string][]).map(([code, name]) => [name, code]),
);

/**
 * The parts of a stored English device label, or null when the label is not one
 * the Worker wrote (cut off, renamed, or from an older format).
 */
export function parseSessionDeviceLabel(label: string): SessionDevice | null {
  if (!label) return null;
  const [name, place, ...rest] = label.split(" · ");
  if (rest.length) return null;
  const match = /^(.*) on (.+)$/.exec(name);
  const appName = match ? match[1] : name;
  const os = match ? match[2] : "";
  const app = englishAppCodes.get(appName);
  if (!app || (os && !isOs(os))) return null;
  const country = place ? countryCodeForEnglishName(place) : "";
  if (place && !country) return null;
  const device: SessionDevice = { app, os: os as SessionDeviceOs | "", country };
  return englishSessionDeviceLabel(device) === label ? device : null;
}

/** Device parts from a Worker response, or null when missing or malformed. */
export function sessionDeviceFromJson(value: unknown): SessionDevice | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!isApp(raw.app)) return null;
  const os = raw.os === "" || raw.os == null ? "" : isOs(raw.os) ? raw.os : null;
  const country = typeof raw.country === "string" && isCountry(raw.country) ? raw.country : "";
  if (os === null) return null;
  return { app: raw.app, os, country };
}

type Translate = (key: string, options?: Record<string, string>) => string;

/**
 * A device name in the UI language. `englishLabel` supplies the country name
 * when the runtime has no country names (some phones).
 */
export function sessionDeviceText(device: SessionDevice, t: Translate, locale: string, englishLabel = ""): string {
  const app = SESSION_DEVICE_BRAND_APPS.includes(device.app)
    ? SESSION_DEVICE_APPS[device.app]
    : t(`settings.sessionDevice.apps.${device.app}`);
  const name = device.os ? t("settings.sessionDevice.appOnOs", { app, os: device.os }) : app;
  if (!device.country) return name;
  let place = countryName(device.country, locale);
  if (place === device.country) place = englishLabel.split(" · ")[1] || place;
  return t("settings.sessionDevice.withPlace", { name, place });
}
