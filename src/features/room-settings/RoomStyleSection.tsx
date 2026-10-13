// Room settings → Style: the room's own accent colour and chat background.
// Changes are staged here and saved with the rest of Room settings.

import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ROOM_ACCENT_SWATCHES, parseRoomAccent } from "../../../shared/room-style";
import { hubMediaDimensionMessage, hubMediaHintMessage } from "../manage-hub/hubMediaText";
import { measureImageFile } from "../manage-hub/measureImage";
import { roomAccentVars } from "./roomStyle";

/** undefined = unchanged, null = remove, File = replace. */
export type RoomBackgroundChange = File | null | undefined;

type Props = {
  roomName: string;
  roomIcon: string;
  accent: string | null;
  onAccentChange: (accent: string | null) => void;
  /** Saved background (absolute URL) shown until a change is staged. */
  savedBackgroundUrl: string | null;
  background: RoomBackgroundChange;
  onBackgroundChange: (change: RoomBackgroundChange) => void;
};

const MAX_BACKGROUND_BYTES = 8 * 1024 * 1024;

/** ROOM_ACCENT_SWATCHES labels, lower-cased: hub.roomSettings.style.swatches.<name>. */
type SwatchName =
  "violet" | "blue" | "cyan" | "teal" | "green" | "lime" | "yellow" | "amber" | "orange" | "red" | "pink" | "steel";

export function RoomStyleSection(props: Props) {
  const { roomName, roomIcon, accent, onAccentChange, savedBackgroundUrl, background, onBackgroundChange } = props;
  const { t } = useTranslation(["hub"]);
  const swatchName = (label: string) =>
    t(`hub.roomSettings.style.swatches.${label.toLowerCase() as SwatchName}`, { defaultValue: label });
  const baseId = useId();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState("");
  const [stagedUrl, setStagedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!(background instanceof File)) {
      setStagedUrl(null);
      return;
    }
    const url = URL.createObjectURL(background);
    setStagedUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [background]);

  const previewUrl = background === null ? null : (stagedUrl ?? savedBackgroundUrl);
  const custom = accent && !ROOM_ACCENT_SWATCHES.some((swatch) => swatch.color === accent) ? accent : null;

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    if (file.size > MAX_BACKGROUND_BYTES) return setError(t("hub.roomSettings.style.tooLarge"));
    if (!file.type.startsWith("image/")) return setError(t("hub.roomSettings.style.notImage"));
    const dims = await measureImageFile(file);
    const dimensionError = hubMediaDimensionMessage("chat-background", dims?.width ?? NaN, dims?.height ?? NaN);
    if (dimensionError) return setError(dimensionError);
    onBackgroundChange(file);
  };

  return (
    <section className="dcx-card" aria-labelledby={`${baseId}-title`}>
      <div className="dcx-row-stack">
        <h3 id={`${baseId}-title`} className="dcx-field-label">
          {t("hub.roomSettings.style.title")}
        </h3>
        <small className="dcx-hint">{t("hub.roomSettings.style.hint")}</small>
      </div>

      <div
        className={`dcr-style-preview${previewUrl ? " has-image" : ""}`}
        style={{
          ...roomAccentVars(accent),
          ...(previewUrl ? { backgroundImage: `url(${previewUrl})` } : {}),
        }}
        aria-hidden="true"
      >
        <span className="dcr-style-preview-icon">{roomIcon || "#"}</span>
        <span className="dcr-style-preview-name">#{roomName || t("hub.roomSettings.style.previewRoom")}</span>
        <span className="dcr-style-preview-send">{t("hub.roomSettings.style.previewSend")}</span>
      </div>

      <fieldset className="dcx-row-stack dcr-fieldset">
        <legend className="dcx-field-label">{t("hub.roomSettings.style.accent")}</legend>
        <div className="dcr-swatches" role="group" aria-label={t("hub.roomSettings.style.accents")}>
          <button
            type="button"
            className={`dcr-swatch dcr-swatch--hub${accent === null ? " is-selected" : ""}`}
            aria-pressed={accent === null}
            onClick={() => onAccentChange(null)}
          >
            {t("hub.roomSettings.style.hubAccent")}
          </button>
          {ROOM_ACCENT_SWATCHES.map((swatch) => (
            <button
              key={swatch.color}
              type="button"
              className={`dcr-swatch${accent === swatch.color ? " is-selected" : ""}`}
              style={{ background: swatch.color }}
              aria-pressed={accent === swatch.color}
              aria-label={swatchName(swatch.label)}
              title={swatchName(swatch.label)}
              onClick={() => onAccentChange(swatch.color)}
            />
          ))}
          <label
            className={`dcr-swatch dcr-swatch--custom${custom ? " is-selected" : ""}`}
            style={custom ? { background: custom } : undefined}
            title={t("hub.roomSettings.style.custom")}
          >
            <span className="dcx-sr-only">{t("hub.roomSettings.style.custom")}</span>
            <input
              type="color"
              value={accent ?? "#7c5cff"}
              onChange={(event) => onAccentChange(parseRoomAccent(event.target.value) ?? null)}
            />
          </label>
        </div>
      </fieldset>

      <div className="dcx-row">
        <div className="dcx-row-copy">
          <strong>{t("hub.roomSettings.style.background")}</strong>
          <small>{t("hub.roomSettings.style.backgroundHint", { spec: hubMediaHintMessage("chat-background") })}</small>
          {error && (
            <small className="dcr-style-error" role="alert">
              {error}
            </small>
          )}
        </div>
        <div className="dcx-row-control dcr-style-actions">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={(event) => {
              void pickFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <button type="button" className="dcx-btn" onClick={() => fileRef.current?.click()}>
            {previewUrl ? t("hub.roomSettings.style.replace") : t("hub.roomSettings.style.upload")}
          </button>
          {previewUrl && (
            <button
              type="button"
              className="dcx-btn dcx-btn-ghost"
              onClick={() => {
                setError("");
                onBackgroundChange(savedBackgroundUrl ? null : undefined);
              }}
            >
              {t("hub.roomSettings.style.remove")}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
