import { useState } from "react";
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
        name: "New squad preset",
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
        setError(result.error ?? "The squad preset could not be saved on this device.");
        return;
      }
      setError("");
      setEditing(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The squad preset could not be saved on this device.");
    }
  };
  return (
    <section className="dc-session-panel" aria-labelledby="squad-presets-title">
      <div className="dc-session-panel-head">
        <div>
          <span className="dc-session-kicker">SQUAD FINDER</span>
          <h2 id="squad-presets-title">Saved presets</h2>
        </div>
        <button type="button" onClick={() => setEditing(draftFor(currentFilters))}>
          New preset
        </button>
      </div>
      {editing && (
        <div className="dc-session-form" style={{ marginTop: 14 }}>
          <label>
            Name
            <input
              value={editing.name}
              maxLength={64}
              onChange={(event) => setEditing((draft) => (draft ? { ...draft, name: event.target.value } : draft))}
            />
          </label>
          <div className="dc-session-form-grid">
            <label>
              Game
              <input
                value={editing.filters.game}
                maxLength={100}
                onChange={(event) => updateFilters({ game: event.target.value })}
              />
            </label>
            <label>
              Platform
              <input
                value={editing.filters.platform}
                maxLength={60}
                onChange={(event) => updateFilters({ platform: event.target.value })}
              />
            </label>
            <label>
              Language
              <input
                value={editing.filters.language}
                maxLength={60}
                onChange={(event) => updateFilters({ language: event.target.value })}
              />
            </label>
            <label>
              Region
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
            Require a microphone
          </label>
          <div className="dc-session-form-grid">
            <label>
              Play style <span className="dc-session-note">saved only</span>
              <select
                value={editing.extras.playStyle}
                onChange={(event) =>
                  updateExtras({ playStyle: event.target.value as SquadPresetDraft["extras"]["playStyle"] })
                }
              >
                <option value="any">Any</option>
                <option value="casual">Casual</option>
                <option value="competitive">Competitive</option>
              </select>
            </label>
            <label>
              Time window <span className="dc-session-note">saved only</span>
              <input
                value={editing.extras.timeWindow ?? ""}
                maxLength={80}
                placeholder="e.g. evenings"
                onChange={(event) => updateExtras({ timeWindow: event.target.value || null })}
              />
            </label>
            <label>
              Party size <span className="dc-session-note">saved only</span>
              <span className="dc-session-row">
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={editing.extras.partySize.min}
                  onChange={(event) =>
                    updateExtras({ partySize: { ...editing.extras.partySize, min: Number(event.target.value) } })
                  }
                  aria-label="Minimum party size"
                />
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={editing.extras.partySize.max}
                  onChange={(event) =>
                    updateExtras({ partySize: { ...editing.extras.partySize, max: Number(event.target.value) } })
                  }
                  aria-label="Maximum party size"
                />
              </span>
            </label>
          </div>
          <p className="dc-session-note">
            Game, platform, language, region, and microphone are sent through the current matcher. The extra preferences
            stay on this device until matcher support exists.
          </p>
          <div className="dc-session-actions">
            <button type="button" className="dc-session-primary" disabled={!editing.filters.game.trim()} onClick={save}>
              Save preset
            </button>
            <button type="button" onClick={() => setEditing(null)}>
              Cancel
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
        {presets.length === 0 && !editing && <p>No presets saved yet.</p>}
        {presets.map((preset) => {
          const extras = unsupportedSquadPresetExtras(preset);
          return (
            <article className="dc-session-card" key={preset.id}>
              <div className="dc-session-card-head">
                <div>
                  <h3>{preset.name}</h3>
                  <p>
                    {preset.filters.game || "Any game"} · {preset.filters.platform} · {preset.filters.region}
                  </p>
                </div>
                <span className="dc-session-note">
                  {preset.filters.microphoneRequired ? "Mic required" : "Mic optional"}
                </span>
              </div>
              {extras.length > 0 && <p className="dc-session-note">Saved only: {extras.join(" · ")}</p>}
              <div className="dc-session-actions">
                <button
                  type="button"
                  className="dc-session-primary"
                  disabled={!preset.filters.game.trim()}
                  onClick={() => onApply(preset, toSupportedSquadSearchRequest(preset.filters))}
                >
                  Use preset
                </button>
                <button type="button" onClick={() => setEditing(draftFor(currentFilters, preset))}>
                  Edit
                </button>
                {onRemove && (
                  <button
                    type="button"
                    className="dc-session-danger"
                    onClick={() => {
                      try {
                        const result = onRemove(preset);
                        if (result && !result.ok)
                          setError(result.error ?? "The squad preset could not be removed from this device.");
                        else setError("");
                      } catch (cause) {
                        setError(
                          cause instanceof Error
                            ? cause.message
                            : "The squad preset could not be removed from this device.",
                        );
                      }
                    }}
                  >
                    Remove
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
