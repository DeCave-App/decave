import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  effectiveQuietPresence,
  presenceStatusForIntent,
  toLegacyPresencePatch,
  type PresenceIntent,
  type QuietPresenceInterruptPolicy,
  type QuietPresenceSettings,
} from "../../session/quiet-presence.ts";
import "./session.css";

export type QuietPresenceSettingsProps = {
  settings: QuietPresenceSettings;
  onChange: (settings: QuietPresenceSettings) => { ok: boolean; error?: string } | void;
  storageError?: string | null;
};

const INTENTS: readonly PresenceIntent[] = ["available", "playing", "watching", "planning", "quiet"];

const INTERRUPTS: readonly (keyof QuietPresenceInterruptPolicy)[] = [
  "urgentMentions",
  "ordinaryJoins",
  "soundboardEvents",
  "recommendations",
];

function expiryOption(expiresAt: string | null, now = Date.now()): string {
  if (!expiresAt) return "none";
  const remaining = Date.parse(expiresAt) - now;
  if (remaining <= 0) return "none";
  if (remaining <= 60 * 60 * 1000 + 60_000) return "hour";
  if (remaining <= 4 * 60 * 60 * 1000 + 60_000) return "four-hours";
  return "today";
}

function expiryForOption(value: string): string | null {
  const now = Date.now();
  if (value === "hour") return new Date(now + 60 * 60 * 1000).toISOString();
  if (value === "four-hours") return new Date(now + 4 * 60 * 60 * 1000).toISOString();
  if (value === "today") {
    const tomorrow = new Date(now);
    tomorrow.setHours(23, 59, 59, 999);
    return tomorrow.toISOString();
  }
  return null;
}

/** Quiet intent controls mapped to the existing profile status and notification preset. */
export function QuietPresenceSettings({ settings, onChange, storageError }: QuietPresenceSettingsProps) {
  const { t } = useTranslation(["settings"]);
  const tk = t as unknown as (key: string) => string;
  const effective = effectiveQuietPresence(settings);
  const patch = toLegacyPresencePatch(settings);
  const [error, setError] = useState("");
  const commit = (next: QuietPresenceSettings) => {
    try {
      const result = onChange(next);
      if (result && !result.ok) {
        setError(result.error ?? t("settings.quietPresence.saveError"));
        return;
      }
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.quietPresence.saveError"));
    }
  };
  const setIntent = (intent: PresenceIntent) => {
    const quiet = intent === "quiet";
    commit({
      ...effective,
      intent,
      presenceStatus: presenceStatusForIntent(intent),
      notificationPreset: quiet
        ? "quiet"
        : effective.notificationPreset === "quiet"
          ? "mentions"
          : effective.notificationPreset,
      interruptPolicy: quiet
        ? {
            ...effective.interruptPolicy,
            ordinaryJoins: false,
            soundboardEvents: false,
            recommendations: false,
            urgentMentions: true,
          }
        : effective.interruptPolicy,
      updatedAt: new Date().toISOString(),
    });
  };
  const setInterrupt = (key: keyof QuietPresenceInterruptPolicy, checked: boolean) =>
    commit({
      ...effective,
      interruptPolicy: { ...effective.interruptPolicy, [key]: checked },
      updatedAt: new Date().toISOString(),
    });
  return (
    <section className="dc-session-form" aria-labelledby="quiet-presence-title">
      <div>
        <span className="dc-session-kicker">{t("settings.quietPresence.kicker")}</span>
        <h2 id="quiet-presence-title">{t("settings.quietPresence.title")}</h2>
        <p>{t("settings.quietPresence.mapping", { status: patch.status, preset: patch.notificationPreset })}</p>
      </div>
      {(error || storageError) && (
        <p className="dc-session-note" role="alert">
          {error || storageError}
        </p>
      )}
      <div className="dc-session-form-grid">
        <label>
          {t("settings.quietPresence.intent")}
          <select
            value={effective.intent}
            onChange={(event) => setIntent(event.target.value as PresenceIntent)}
            aria-label={t("settings.quietPresence.intentLabel")}
          >
            {INTENTS.map((value) => (
              <option key={value} value={value}>
                {tk(`settings.quietPresence.intents.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("settings.quietPresence.expires")}
          <select
            value={expiryOption(effective.expiresAt)}
            onChange={(event) =>
              commit({
                ...effective,
                expiresAt: expiryForOption(event.target.value),
                updatedAt: new Date().toISOString(),
              })
            }
            aria-label={t("settings.quietPresence.expiryLabel")}
          >
            <option value="none">{t("settings.quietPresence.expiry.none")}</option>
            <option value="hour">{t("settings.quietPresence.expiry.hour")}</option>
            <option value="four-hours">{t("settings.quietPresence.expiry.fourHours")}</option>
            <option value="today">{t("settings.quietPresence.expiry.today")}</option>
          </select>
        </label>
      </div>
      <div>
        <span className="dc-session-kicker">{t("settings.quietPresence.interrupts")}</span>
        <div className="dc-session-form-grid" style={{ marginTop: 10 }}>
          {INTERRUPTS.map((key) => (
            <label className="dc-session-checkbox" key={key}>
              <input
                type="checkbox"
                checked={effective.interruptPolicy[key]}
                onChange={(event) => setInterrupt(key, event.target.checked)}
              />
              {tk(`settings.quietPresence.interrupt.${key}`)}
            </label>
          ))}
        </div>
      </div>
      <p className="dc-session-note">{t("settings.quietPresence.note")}</p>
    </section>
  );
}
