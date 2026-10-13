import { useState } from "react";
import { useTranslation } from "react-i18next";
import { i18next } from "../../i18n/index.ts";
import { squadValueLabel } from "../../app/views/squadLabels";
import {
  createSquadPreset,
  toSupportedSquadSearchRequest,
  unsupportedSquadPresetExtras,
  type SquadPreset,
  type SquadPresetDraft,
  type SupportedSquadFilters,
} from "../../session/squad-presets.ts";
import "./session.css";

export type SquadFinderPresetsProps = {
  presets: readonly SquadPreset[];
  currentFilters: SupportedSquadFilters;
  onApply: (preset: SquadPreset, request: SupportedSquadFilters) => void;
  onSave: (preset: SquadPreset) => { ok: boolean; error?: string } | void;
  onRemove?: (preset: SquadPreset) => { ok: boolean; error?: string } | void;
  storageError?: string | null;
};

function draftFor(currentFilters: SupportedSquadFilters, preset?: SquadPreset): SquadPresetDraft {
  return preset
    ? {
        name: preset.name,
        filters: { ...preset.filters },
        extras: { ...preset.extras, partySize: { ...preset.extras.partySize } },
        id: preset.id,
        createdAt: preset.createdAt,
      }
    : {
        name: i18next.t("chat.session.presets.newName"),
        filters: { ...currentFilters },
        extras: { playStyle: "any", timeWindow: null, partySize: { min: 1, max: 4 } },
      };
}

/** Saved Squad Finder presets with a visible boundary around unsupported matcher fields. */
export function SquadFinderPresets({
  presets,
  currentFilters,
  onApply,
  onSave,
  onRemove,
  storageError,
}: SquadFinderPresetsProps) {
  const { t } = useTranslation(["chat"]);
  const [editing, setEditing] = useState<SquadPresetDraft | null>(null);
  const [error, setError] = useState("");
  const updateFilters = (patch: Partial<SupportedSquadFilters>) =>
    setEditing((draft) => (draft ? { ...draft, filters: { ...draft.filters, ...patch } } : draft));
  const updateExtras = (patch: Partial<SquadPresetDraft["extras"]>) =>
    setEditing((draft) => (draft ? { ...draft, extras: { ...draft.extras, ...patch } } : draft));
  const save = () => {
    if (!editing) return;
    const preset = createSquadPreset(editing);
    try {
      const result = onSave(preset);
      if (result && !result.ok) {
        setError(result.error ?? t("chat.session.presets.saveFailed"));
        return;
      }
      setError("");
      setEditing(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("chat.session.presets.saveFailed"));
    }
  };
  return (
    <section className="dc-session-panel" aria-labelledby="squad-presets-title">
      <div className="dc-session-panel-head">
        <div>
          <span className="dc-session-kicker">{t("chat.session.presets.kicker")}</span>
          <h2 id="squad-presets-title">{t("chat.session.presets.title")}</h2>
        </div>
        <button type="button" onClick={() => setEditing(draftFor(currentFilters))}>
          {t("chat.session.presets.new")}
        </button>
      </div>
      {editing && (
        <div className="dc-session-form" style={{ marginTop: 14 }}>
          <label>
            {t("chat.session.presets.name")}
            <input
              value={editing.name}
              maxLength={64}
              onChange={(event) => setEditing((draft) => (draft ? { ...draft, name: event.target.value } : draft))}
            />
          </label>
          <div className="dc-session-form-grid">
            <label>
              {t("chat.session.presets.game")}
              <input
                value={editing.filters.game}
                maxLength={100}
                onChange={(event) => updateFilters({ game: event.target.value })}
              />
            </label>
            <label>
              {t("chat.session.presets.platform")}
              <input
                value={editing.filters.platform}
                maxLength={60}
                onChange={(event) => updateFilters({ platform: event.target.value })}
              />
            </label>
            <label>
              {t("chat.session.presets.language")}
              <input
                value={editing.filters.language}
                maxLength={60}
                onChange={(event) => updateFilters({ language: event.target.value })}
              />
            </label>
            <label>
              {t("chat.session.presets.region")}
              <input
                value={editing.filters.region}
                maxLength={60}
                onChange={(event) => updateFilters({ region: event.target.value })}
              />
            </label>
          </div>
          <label className="dc-session-checkbox">
            <input
              type="checkbox"
              checked={editing.filters.microphoneRequired}
              onChange={(event) => updateFilters({ microphoneRequired: event.target.checked })}
            />
            {t("chat.session.presets.requireMic")}
          </label>
          <div className="dc-session-form-grid">
            <label>
              {t("chat.session.squad.playStyle")}{" "}
              <span className="dc-session-note">{t("chat.session.presets.savedOnly")}</span>
              <select
                value={editing.extras.playStyle}
                onChange={(event) =>
                  updateExtras({ playStyle: event.target.value as SquadPresetDraft["extras"]["playStyle"] })
                }
              >
                <option value="any">{t("chat.session.presets.styleAny")}</option>
                <option value="casual">{t("chat.session.presets.styleCasual")}</option>
                <option value="competitive">{t("chat.session.presets.styleCompetitive")}</option>
              </select>
            </label>
            <label>
              {t("chat.session.squad.timeWindow")}{" "}
              <span className="dc-session-note">{t("chat.session.presets.savedOnly")}</span>
              <input
                value={editing.extras.timeWindow ?? ""}
                maxLength={80}
                placeholder={t("chat.session.presets.timeWindowPlaceholder")}
                onChange={(event) => updateExtras({ timeWindow: event.target.value || null })}
              />
            </label>
            <label>
              {t("chat.session.squad.partySize")}{" "}
              <span className="dc-session-note">{t("chat.session.presets.savedOnly")}</span>
              <span className="dc-session-row">
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={editing.extras.partySize.min}
                  onChange={(event) =>
                    updateExtras({ partySize: { ...editing.extras.partySize, min: Number(event.target.value) } })
                  }
                  aria-label={t("chat.session.presets.partyMin")}
                />
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={editing.extras.partySize.max}
                  onChange={(event) =>
                    updateExtras({ partySize: { ...editing.extras.partySize, max: Number(event.target.value) } })
                  }
                  aria-label={t("chat.session.presets.partyMax")}
                />
              </span>
            </label>
          </div>
          <p className="dc-session-note">{t("chat.session.presets.matcherNote")}</p>
          <div className="dc-session-actions">
            <button type="button" className="dc-session-primary" disabled={!editing.filters.game.trim()} onClick={save}>
              {t("chat.session.presets.save")}
            </button>
            <button type="button" onClick={() => setEditing(null)}>
              {t("chat.session.cancel")}
            </button>
          </div>
        </div>
      )}
      {(error || storageError) && (
        <p className="dc-session-note" role="alert">
          {error || storageError}
        </p>
      )}
      <div className="dc-session-panel-list">
        {presets.length === 0 && !editing && <p>{t("chat.session.presets.empty")}</p>}
        {presets.map((preset) => {
          const extras = unsupportedSquadPresetExtras(preset);
          return (
            <article className="dc-session-card" key={preset.id}>
              <div className="dc-session-card-head">
                <div>
                  <h3>{preset.name}</h3>
                  <p>
                    {preset.filters.game || t("chat.session.presets.anyGame")} ·{" "}
                    {squadValueLabel("platform", preset.filters.platform)} ·{" "}
                    {squadValueLabel("region", preset.filters.region)}
                  </p>
                </div>
                <span className="dc-session-note">
                  {preset.filters.microphoneRequired
                    ? t("chat.session.presets.micRequired")
                    : t("chat.session.presets.micOptional")}
                </span>
              </div>
              {extras.length > 0 && (
                <p className="dc-session-note">
                  {t("chat.session.presets.savedOnlyList", { items: extras.join(" · ") })}
                </p>
              )}
              <div className="dc-session-actions">
                <button
                  type="button"
                  className="dc-session-primary"
                  disabled={!preset.filters.game.trim()}
                  onClick={() => onApply(preset, toSupportedSquadSearchRequest(preset.filters))}
                >
                  {t("chat.session.presets.use")}
                </button>
                <button type="button" onClick={() => setEditing(draftFor(currentFilters, preset))}>
                  {t("chat.session.presets.edit")}
                </button>
                {onRemove && (
                  <button
                    type="button"
                    className="dc-session-danger"
                    onClick={() => {
                      try {
                        const result = onRemove(preset);
                        if (result && !result.ok) setError(result.error ?? t("chat.session.presets.removeFailed"));
                        else setError("");
                      } catch (cause) {
                        setError(cause instanceof Error ? cause.message : t("chat.session.presets.removeFailed"));
                      }
                    }}
                  >
                    {t("chat.session.kitPanel.remove")}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
