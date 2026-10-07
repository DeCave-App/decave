import { useState } from "react";
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

const INTENTS: readonly [PresenceIntent, string][] = [
  ["available", "Available"],
  ["playing", "Playing"],
  ["watching", "Watching"],
  ["planning", "Planning"],
  ["quiet", "Quiet"],
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
  const effective = effectiveQuietPresence(settings);
  const patch = toLegacyPresencePatch(settings);
  const [error, setError] = useState("");
  const commit = (next: QuietPresenceSettings) => {
    try {
      const result = onChange(next);
      if (result && !result.ok) {
        setError(result.error ?? "Quiet presence could not be saved on this device.");
        return;
      }
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Quiet presence could not be saved on this device.");
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
        <span className="dc-session-kicker">QUIET PRESENCE</span>
        <h2 id="quiet-presence-title">Share intent, keep control</h2>
        <p>
          Presence uses the existing {patch.status} status and {patch.notificationPreset} notification preset.
        </p>
      </div>
      {(error || storageError) && (
        <p className="dc-session-note" role="alert">
          {error || storageError}
        </p>
      )}
      <div className="dc-session-form-grid">
        <label>
          Intent
          <select
            value={effective.intent}
            onChange={(event) => setIntent(event.target.value as PresenceIntent)}
            aria-label="Presence intent"
          >
            {INTENTS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Expires
          <select
            value={expiryOption(effective.expiresAt)}
            onChange={(event) =>
              commit({
                ...effective,
                expiresAt: expiryForOption(event.target.value),
                updatedAt: new Date().toISOString(),
              })
            }
            aria-label="Presence expiry"
          >
            <option value="none">Until I change it</option>
            <option value="hour">For 1 hour</option>
            <option value="four-hours">For 4 hours</option>
            <option value="today">Until end of day</option>
          </select>
        </label>
      </div>
      <div>
        <span className="dc-session-kicker">INTERRUPTS</span>
        <div className="dc-session-form-grid" style={{ marginTop: 10 }}>
          <label className="dc-session-checkbox">
            <input
              type="checkbox"
              checked={effective.interruptPolicy.urgentMentions}
              onChange={(event) => setInterrupt("urgentMentions", event.target.checked)}
            />
            Urgent mentions
          </label>
          <label className="dc-session-checkbox">
            <input
              type="checkbox"
              checked={effective.interruptPolicy.ordinaryJoins}
              onChange={(event) => setInterrupt("ordinaryJoins", event.target.checked)}
            />
            Ordinary joins
          </label>
          <label className="dc-session-checkbox">
            <input
              type="checkbox"
              checked={effective.interruptPolicy.soundboardEvents}
              onChange={(event) => setInterrupt("soundboardEvents", event.target.checked)}
            />
            Soundboard events
          </label>
          <label className="dc-session-checkbox">
            <input
              type="checkbox"
              checked={effective.interruptPolicy.recommendations}
              onChange={(event) => setInterrupt("recommendations", event.target.checked)}
            />
            Recommendations
          </label>
        </div>
      </div>
      <p className="dc-session-note">
        Saved locally by the integration. Squad Finder availability follows this intent; urgent mentions remain
        separately controlled.
      </p>
    </section>
  );
}
