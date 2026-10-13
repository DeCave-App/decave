import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Trans, useTranslation } from "react-i18next";
import {
  HUB_EVENT_LIMITS,
  isValidTimeZone,
  wallClockInZone,
  zonedWallToEpoch,
  type HubEvent,
  type HubEventAudience,
  type HubEventRecurrence,
} from "../../../shared/hub-events";
import { useDialogA11y } from "../shared/useDialogA11y";
import { createHubEvent, updateHubEvent, HubEventApiError, type EventsApiContext, type HubEventBody } from "./api";
import { DEFAULT_EVENT_DURATION_MS, formatTimeRange, viewerTimeZone, type EventRoom } from "./model";
import "../shared/shared.css";
import "./events.css";
import { Icon } from "../../components/Icon";

export type EventComposerSeed = {
  start?: number;
  end?: number;
  editing?: HubEvent | null;
  voiceChannelId?: number | null;
  channelId?: number | null;
  audienceMemberIds?: string[];
};

export type EventComposerSheetProps = {
  hubId: number;
  hubName: string;
  rooms: EventRoom[];
  roles: Array<{ id: string; name: string; color?: string }>;
  members: Array<{ userId: string; username: string }>;
  currentUserId?: string;
  api: EventsApiContext;
  seed: EventComposerSeed;
  resolveMediaUrl: (url: string) => string;
  renderAvatar: (userId: string) => ReactNode;
  onClose: () => void;
  onSaved: (event: HubEvent, created: boolean) => void;
};

type Errors = Partial<Record<string, string>>;

const DURATIONS = [
  { id: "m30", ms: 30 * 60_000 },
  { id: "h1", ms: 60 * 60_000 },
  { id: "h1_5", ms: 90 * 60_000 },
  { id: "h2", ms: 2 * 60 * 60_000 },
  { id: "h3", ms: 3 * 60 * 60_000 },
  { id: "h4", ms: 4 * 60 * 60_000 },
  { id: "evening", ms: 6 * 60 * 60_000 },
] as const;
const REMINDERS = [
  { id: "none", value: null },
  { id: "atStart", value: 0 },
  { id: "m10", value: 10 },
  { id: "m30", value: 30 },
  { id: "h1", value: 60 },
  { id: "d1", value: 1440 },
] as const;

/** A URL shape, the same in every language. */
const COVER_URL_EXAMPLE = "https://…";

const pad = (n: number) => String(n).padStart(2, "0");
function epochToZonedInput(ms: number, tz: string): string {
  const w = wallClockInZone(ms, tz);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}
function zonedInputToEpoch(value: string, tz: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return Number.NaN;
  return zonedWallToEpoch(
    { year: +match[1], month: +match[2], day: +match[3], hour: +match[4], minute: +match[5], second: 0, ms: 0 },
    tz,
  );
}
function nextRoundHour(now: number): number {
  const d = new Date(now + 60 * 60_000);
  d.setMinutes(0, 0, 0);
  return d.getTime();
}
function allTimeZones(current: string): string[] {
  let zones: string[] = [];
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
    zones = supported ? supported("timeZone") : [];
  } catch {
    zones = [];
  }
  if (!zones.length)
    zones = [
      "UTC",
      "Europe/London",
      "Europe/Berlin",
      "Europe/Athens",
      "America/New_York",
      "America/Chicago",
      "America/Los_Angeles",
      "Asia/Tokyo",
      "Australia/Sydney",
    ];
  return zones.includes(current) ? zones : [current, ...zones];
}
function validCover(value: string): boolean {
  if (value.startsWith("/uploads/") || value.startsWith("/api/media/")) return true;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

const STEP1_FIELDS = new Set([
  "title",
  "description",
  "coverUrl",
  "startsAt",
  "endsAt",
  "timezone",
  "recurrence",
  "channelId",
  "voiceChannelId",
]);

export function EventComposerSheet(props: EventComposerSheetProps) {
  const { t } = useTranslation(["events"]);
  const { seed, rooms } = props;
  const editing = seed.editing ?? null;
  const titleId = useId();
  const dialogRef = useDialogA11y<HTMLDivElement>(props.onClose);
  const textRooms = rooms.filter((room) => room.type === "text");
  const voiceRooms = rooms.filter((room) => room.type === "voice");

  const initialTz = editing?.timezone && isValidTimeZone(editing.timezone) ? editing.timezone : viewerTimeZone();
  const initialStart = editing?.startsAt ?? seed.start ?? nextRoundHour(Date.now());
  const initialDuration = editing
    ? editing.endsAt !== null
      ? editing.endsAt - editing.startsAt
      : null
    : seed.end && seed.start
      ? seed.end - seed.start
      : DEFAULT_EVENT_DURATION_MS;

  const [step, setStep] = useState<1 | 2>(1);
  const [title, setTitle] = useState(editing?.title ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [coverUrl, setCoverUrl] = useState(editing?.coverUrl ?? "");
  const [timezone, setTimezone] = useState(initialTz);
  const [startInput, setStartInput] = useState(() => epochToZonedInput(initialStart, initialTz));
  const [endMode, setEndMode] = useState<"duration" | "end" | "none">(
    initialDuration === null ? "none" : DURATIONS.some((d) => d.ms === initialDuration) ? "duration" : "end",
  );
  const [durationMs, setDurationMs] = useState(
    initialDuration && DURATIONS.some((d) => d.ms === initialDuration) ? initialDuration : DEFAULT_EVENT_DURATION_MS,
  );
  const [endInput, setEndInput] = useState(() =>
    epochToZonedInput(initialStart + (initialDuration ?? DEFAULT_EVENT_DURATION_MS), initialTz),
  );
  const [recurrence, setRecurrence] = useState<HubEventRecurrence>(editing?.recurrence ?? "none");
  const [voiceChannelId, setVoiceChannelId] = useState<number | null>(
    editing ? editing.voiceChannelId : (seed.voiceChannelId ?? null),
  );
  const [channelId, setChannelId] = useState<number | null>(
    editing ? editing.channelId : (seed.channelId ?? textRooms[0]?.id ?? null),
  );
  const [audience, setAudience] = useState<HubEventAudience>(
    editing?.audience ?? (seed.audienceMemberIds?.length ? "members" : "all"),
  );
  const [roleIds, setRoleIds] = useState<string[]>(editing?.audience === "roles" ? editing.audienceIds : []);
  const [memberIds, setMemberIds] = useState<string[]>(
    editing
      ? editing.audience === "members"
        ? editing.audienceIds
        : []
      : (seed.audienceMemberIds ?? []).slice(0, HUB_EVENT_LIMITS.audienceIdsMax),
  );
  const [memberSearch, setMemberSearch] = useState("");
  const [reminder, setReminder] = useState<number | null>(editing ? editing.reminderMinutes : 30);
  const [capacity, setCapacity] = useState(editing?.capacity ? String(editing.capacity) : "");
  const [gameTag, setGameTag] = useState(editing?.gameTag ?? "");
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const zones = useMemo(() => allTimeZones(initialTz), [initialTz]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const changeTimezone = (next: string) => {
    // Keep the same instant when switching zones so the preview doesn't jump.
    const start = zonedInputToEpoch(startInput, timezone);
    const end = zonedInputToEpoch(endInput, timezone);
    setTimezone(next);
    if (Number.isFinite(start)) setStartInput(epochToZonedInput(start, next));
    if (Number.isFinite(end)) setEndInput(epochToZonedInput(end, next));
  };

  const startsAt = zonedInputToEpoch(startInput, timezone);
  const endsAt =
    endMode === "none"
      ? null
      : endMode === "duration"
        ? Number.isFinite(startsAt)
          ? startsAt + durationMs
          : Number.NaN
        : zonedInputToEpoch(endInput, timezone);
  const startChanged = !editing || startsAt !== editing.startsAt;
  const minStart = epochToZonedInput(now, timezone);

  const validateStep1 = (): Errors => {
    const next: Errors = {};
    const cleanTitle = title.trim();
    if (!cleanTitle) next.title = t("events.composer.errors.titleMissing");
    else if (cleanTitle.length > HUB_EVENT_LIMITS.titleMax)
      next.title = t("events.composer.errors.titleLong", { max: HUB_EVENT_LIMITS.titleMax });
    if (description.length > HUB_EVENT_LIMITS.descriptionMax)
      next.description = t("events.composer.errors.descriptionLong", { max: HUB_EVENT_LIMITS.descriptionMax });
    if (coverUrl.trim() && !validCover(coverUrl.trim())) next.coverUrl = t("events.composer.errors.cover");
    if (!isValidTimeZone(timezone)) next.timezone = t("events.composer.errors.timezone");
    if (!Number.isFinite(startsAt)) next.startsAt = t("events.composer.errors.startMissing");
    else if (startChanged && startsAt < Date.now() - HUB_EVENT_LIMITS.pastToleranceMs)
      next.startsAt = t("events.composer.errors.startPast");
    if (endsAt !== null) {
      if (!Number.isFinite(endsAt)) next.endsAt = t("events.composer.errors.endMissing");
      else if (Number.isFinite(startsAt) && endsAt <= startsAt)
        next.endsAt = t("events.composer.errors.endBeforeStart");
      else if (Number.isFinite(startsAt) && endsAt - startsAt > HUB_EVENT_LIMITS.maxDurationMs)
        next.endsAt = t("events.composer.errors.tooLong");
    }
    return next;
  };
  const validateStep2 = (): Errors => {
    const next: Errors = {};
    if (audience === "roles" && roleIds.length === 0) next.audienceIds = t("events.composer.errors.noRoles");
    if (audience === "members" && memberIds.length === 0) next.audienceIds = t("events.composer.errors.noMembers");
    if ((audience === "roles" ? roleIds : memberIds).length > HUB_EVENT_LIMITS.audienceIdsMax)
      next.audienceIds = t("events.composer.errors.tooManyEntries", { max: HUB_EVENT_LIMITS.audienceIdsMax });
    if (capacity.trim()) {
      const n = Number(capacity);
      if (!Number.isInteger(n) || n < 1 || n > HUB_EVENT_LIMITS.capacityMax)
        next.capacity = t("events.composer.errors.capacity", { max: HUB_EVENT_LIMITS.capacityMax });
    }
    if (gameTag.trim().length > HUB_EVENT_LIMITS.gameTagMax)
      next.gameTag = t("events.composer.errors.gameTagLong", { max: HUB_EVENT_LIMITS.gameTagMax });
    return next;
  };

  const goNext = () => {
    const found = validateStep1();
    setErrors(found);
    if (Object.keys(found).length === 0) setStep(2);
  };

  const submit = async () => {
    const step1 = validateStep1();
    const step2 = validateStep2();
    const all = { ...step1, ...step2 };
    setErrors(all);
    if (Object.keys(step1).length) {
      setStep(1);
      return;
    }
    if (Object.keys(step2).length || busy) return;
    const body: HubEventBody = {
      title: title.trim(),
      description: description.trim(),
      coverUrl: coverUrl.trim() || null,
      endsAt,
      timezone,
      recurrence,
      audience,
      audienceIds: audience === "roles" ? roleIds : audience === "members" ? memberIds : [],
      reminderMinutes: reminder,
      capacity: capacity.trim() ? Number(capacity) : null,
      gameTag: gameTag.trim() || null,
      channelId,
      voiceChannelId,
    };
    if (startChanged) body.startsAt = startsAt;
    setBusy(true);
    setServerError("");
    try {
      const saved = editing
        ? await updateHubEvent(props.api, props.hubId, editing.id, body)
        : await createHubEvent(props.api, props.hubId, body);
      props.onSaved(saved, !editing);
    } catch (error) {
      const message = error instanceof Error ? error.message : t("events.composer.saveFailed");
      if (error instanceof HubEventApiError && error.field) {
        setErrors({ [error.field]: message });
        setStep(STEP1_FIELDS.has(error.field) ? 1 : 2);
      } else {
        setServerError(message);
      }
    } finally {
      setBusy(false);
    }
  };

  const filteredMembers = props.members
    .filter((member) => member.userId !== props.currentUserId)
    .filter(
      (member) => !memberSearch.trim() || member.username.toLowerCase().includes(memberSearch.trim().toLowerCase()),
    )
    .slice(0, 60);
  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((value) => value !== id) : [...list, id];
  const fieldError = (field: string) =>
    errors[field] ? (
      <small className="evx-field-error" id={`${titleId}-${field}-err`} role="alert">
        {errors[field]}
      </small>
    ) : null;
  const describedBy = (field: string) => (errors[field] ? `${titleId}-${field}-err` : undefined);
  const previewRoom = voiceChannelId ? voiceRooms.find((room) => room.id === voiceChannelId) : null;

  const body = (
    <div
      className="evx-overlay center"
      data-hub-calendar-page="true"
      data-hub-events-dialog="open"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) props.onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="evx-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-dc-dialog="open"
        tabIndex={-1}
      >
        <header className="evx-sheet-head">
          <div>
            <p className="evx-kicker">{props.hubName}</p>
            <h2 id={titleId}>{editing ? t("events.composer.editTitle") : t("events.composer.createTitle")}</h2>
          </div>
          <ol className="evx-steps" aria-label={t("events.composer.steps")}>
            <li className={step === 1 ? "active" : "done"} aria-current={step === 1 ? "step" : undefined}>
              <button type="button" onClick={() => setStep(1)}>
                {t("events.composer.stepBasics")}
              </button>
            </li>
            <li className={step === 2 ? "active" : ""} aria-current={step === 2 ? "step" : undefined}>
              <button type="button" onClick={goNext}>
                {t("events.composer.stepAudience")}
              </button>
            </li>
          </ol>
          <button
            type="button"
            className="evx-icon-btn"
            onClick={props.onClose}
            aria-label={t("events.composer.close")}
            disabled={busy}
          >
            <Icon name="close" size="sm" />
          </button>
        </header>

        <div className="evx-sheet-body">
          <div className="evx-form">
            {step === 1 ? (
              <>
                <label className="evx-field">
                  <span>{t("events.composer.title")}</span>
                  <input
                    data-autofocus
                    value={title}
                    maxLength={HUB_EVENT_LIMITS.titleMax}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={t("events.composer.titlePlaceholder")}
                    aria-invalid={Boolean(errors.title)}
                    aria-describedby={describedBy("title")}
                  />
                  {fieldError("title")}
                </label>
                <label className="evx-field">
                  <span>
                    <Trans t={t} i18nKey="events.composer.cover" components={{ em: <em /> }} />
                  </span>
                  <input
                    type="url"
                    inputMode="url"
                    value={coverUrl}
                    onChange={(e) => setCoverUrl(e.target.value)}
                    placeholder={COVER_URL_EXAMPLE}
                    aria-invalid={Boolean(errors.coverUrl)}
                    aria-describedby={describedBy("coverUrl")}
                  />
                  {fieldError("coverUrl")}
                </label>
                <div className="evx-grid-2">
                  <label className="evx-field">
                    <span>{t("events.composer.starts")}</span>
                    <input
                      type="datetime-local"
                      value={startInput}
                      min={startChanged ? minStart : undefined}
                      onChange={(e) => setStartInput(e.target.value)}
                      aria-invalid={Boolean(errors.startsAt)}
                      aria-describedby={describedBy("startsAt")}
                    />
                    {fieldError("startsAt")}
                  </label>
                  <label className="evx-field">
                    <span>{t("events.composer.timezone")}</span>
                    <select
                      value={timezone}
                      onChange={(e) => changeTimezone(e.target.value)}
                      aria-invalid={Boolean(errors.timezone)}
                    >
                      {zones.map((zone) => (
                        <option key={zone} value={zone}>
                          {zone.replace(/_/g, " ")}
                        </option>
                      ))}
                    </select>
                    {fieldError("timezone")}
                  </label>
                </div>
                <div className="evx-grid-2">
                  <label className="evx-field">
                    <span>{t("events.composer.ends")}</span>
                    <select value={endMode} onChange={(e) => setEndMode(e.target.value as typeof endMode)}>
                      <option value="duration">{t("events.composer.endDuration")}</option>
                      <option value="end">{t("events.composer.endTime")}</option>
                      <option value="none">{t("events.composer.endNone")}</option>
                    </select>
                  </label>
                  {endMode === "duration" && (
                    <label className="evx-field">
                      <span>{t("events.composer.duration")}</span>
                      <select value={durationMs} onChange={(e) => setDurationMs(Number(e.target.value))}>
                        {DURATIONS.map((d) => (
                          <option key={d.ms} value={d.ms}>
                            {t(`events.composer.durations.${d.id}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {endMode === "end" && (
                    <label className="evx-field">
                      <span>{t("events.composer.endTimeLabel")}</span>
                      <input
                        type="datetime-local"
                        value={endInput}
                        min={startInput || minStart}
                        onChange={(e) => setEndInput(e.target.value)}
                        aria-invalid={Boolean(errors.endsAt)}
                        aria-describedby={describedBy("endsAt")}
                      />
                    </label>
                  )}
                </div>
                {fieldError("endsAt")}
                <div className="evx-grid-2">
                  <label className="evx-field">
                    <span>{t("events.composer.repeats")}</span>
                    <select value={recurrence} onChange={(e) => setRecurrence(e.target.value as HubEventRecurrence)}>
                      <option value="none">{t("events.composer.recurrence.none")}</option>
                      <option value="daily">{t("events.composer.recurrence.daily")}</option>
                      <option value="weekly">{t("events.composer.recurrence.weekly")}</option>
                      <option value="monthly">{t("events.composer.recurrence.monthly")}</option>
                    </select>
                    {fieldError("recurrence")}
                  </label>
                  <label className="evx-field">
                    <span>{t("events.composer.voiceRoom")}</span>
                    <select
                      value={voiceChannelId ?? ""}
                      onChange={(e) => setVoiceChannelId(e.target.value ? Number(e.target.value) : null)}
                      aria-invalid={Boolean(errors.voiceChannelId)}
                    >
                      <option value="">{t("events.composer.noVoiceRoom")}</option>
                      {voiceRooms.map((room) => (
                        <option key={room.id} value={room.id}>
                          {room.name}
                        </option>
                      ))}
                    </select>
                    {fieldError("voiceChannelId")}
                  </label>
                </div>
                <label className="evx-field">
                  <span>{t("events.composer.announce")}</span>
                  <select
                    value={channelId ?? ""}
                    onChange={(e) => setChannelId(e.target.value ? Number(e.target.value) : null)}
                    aria-invalid={Boolean(errors.channelId)}
                  >
                    <option value="">{t("events.composer.noAnnounce")}</option>
                    {textRooms.map((room) => (
                      <option key={room.id} value={room.id}>
                        #{room.name}
                      </option>
                    ))}
                  </select>
                  {fieldError("channelId")}
                </label>
                <label className="evx-field">
                  <span>
                    <Trans t={t} i18nKey="events.composer.description" components={{ em: <em /> }} />
                  </span>
                  <textarea
                    rows={4}
                    value={description}
                    maxLength={HUB_EVENT_LIMITS.descriptionMax}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={t("events.composer.descriptionPlaceholder")}
                    aria-invalid={Boolean(errors.description)}
                  />
                  <small className="evx-counter">
                    {description.length}/{HUB_EVENT_LIMITS.descriptionMax}
                  </small>
                  {fieldError("description")}
                </label>
              </>
            ) : (
              <>
                <fieldset className="evx-field">
                  <legend>{t("events.composer.audience")}</legend>
                  <div className="evx-segment" role="radiogroup" aria-label={t("events.composer.audienceLabel")}>
                    {(["all", "roles", "members"] as HubEventAudience[]).map((value) => (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={audience === value}
                        className={audience === value ? "active" : ""}
                        onClick={() => setAudience(value)}
                      >
                        {t(`events.composer.audiences.${value}`)}
                      </button>
                    ))}
                  </div>
                  {audience === "roles" && (
                    <div className="evx-pick-list">
                      {props.roles.length === 0 && <small className="evx-note">{t("events.composer.noRoles")}</small>}
                      {props.roles.map((role) => (
                        <label key={role.id} className="evx-pick">
                          <input
                            type="checkbox"
                            checked={roleIds.includes(role.id)}
                            onChange={() => setRoleIds((list) => toggle(list, role.id))}
                          />
                          <span
                            className="evx-role-dot"
                            style={{ background: role.color || "var(--ds-accent)" }}
                            aria-hidden="true"
                          />
                          <span>{role.name}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  {audience === "members" && (
                    <>
                      <input
                        type="search"
                        className="evx-search"
                        value={memberSearch}
                        onChange={(e) => setMemberSearch(e.target.value)}
                        placeholder={t("events.composer.searchPlaceholder")}
                        aria-label={t("events.composer.search")}
                      />
                      <div className="evx-pick-list">
                        {filteredMembers.map((member) => (
                          <label key={member.userId} className="evx-pick">
                            <input
                              type="checkbox"
                              checked={memberIds.includes(member.userId)}
                              onChange={() => setMemberIds((list) => toggle(list, member.userId))}
                            />
                            <span className="evx-avatar sm">{props.renderAvatar(member.userId)}</span>
                            <span>{member.username}</span>
                          </label>
                        ))}
                        {filteredMembers.length === 0 && (
                          <small className="evx-note">{t("events.composer.noMatch")}</small>
                        )}
                      </div>
                      <small className="evx-note">{t("events.composer.selected", { count: memberIds.length })}</small>
                    </>
                  )}
                  {fieldError("audienceIds")}
                  {fieldError("audience")}
                </fieldset>
                <div className="evx-grid-2">
                  <label className="evx-field">
                    <span>{t("events.composer.reminder")}</span>
                    <select
                      value={reminder ?? ""}
                      onChange={(e) => setReminder(e.target.value === "" ? null : Number(e.target.value))}
                    >
                      {REMINDERS.map((r) => (
                        <option key={r.id} value={r.value ?? ""}>
                          {t(`events.composer.reminders.${r.id}`)}
                        </option>
                      ))}
                    </select>
                    {fieldError("reminderMinutes")}
                  </label>
                  <label className="evx-field">
                    <span>
                      <Trans t={t} i18nKey="events.composer.capacity" components={{ em: <em /> }} />
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={HUB_EVENT_LIMITS.capacityMax}
                      inputMode="numeric"
                      value={capacity}
                      onChange={(e) => setCapacity(e.target.value)}
                      placeholder={t("events.composer.unlimited")}
                      aria-invalid={Boolean(errors.capacity)}
                      aria-describedby={describedBy("capacity")}
                    />
                    {fieldError("capacity")}
                  </label>
                </div>
                <label className="evx-field">
                  <span>
                    <Trans t={t} i18nKey="events.composer.gameTag" components={{ em: <em /> }} />
                  </span>
                  <input
                    value={gameTag}
                    maxLength={HUB_EVENT_LIMITS.gameTagMax}
                    onChange={(e) => setGameTag(e.target.value)}
                    placeholder={t("events.composer.gameTagPlaceholder")}
                    aria-invalid={Boolean(errors.gameTag)}
                  />
                  {fieldError("gameTag")}
                </label>
              </>
            )}
          </div>

          <aside className="evx-preview" aria-label={t("events.composer.preview")}>
            <p className="evx-kicker">{t("events.composer.preview")}</p>
            <div className="evx-preview-card">
              <div className={`evx-preview-cover${coverUrl.trim() && validCover(coverUrl.trim()) ? " has-image" : ""}`}>
                {coverUrl.trim() && validCover(coverUrl.trim()) && (
                  <img src={props.resolveMediaUrl(coverUrl.trim())} alt="" />
                )}
              </div>
              <div className="evx-preview-copy">
                <strong>{title.trim() || t("events.composer.untitled")}</strong>
                <small>
                  {Number.isFinite(startsAt)
                    ? formatTimeRange(startsAt, endsAt !== null && Number.isFinite(endsAt) ? endsAt : null)
                    : t("events.composer.pickTime")}
                </small>
                <div className="evx-chip-row">
                  {recurrence !== "none" && (
                    <span className="evx-chip">{t(`events.composer.repeatsChip.${recurrence}`)}</span>
                  )}
                  {previewRoom && (
                    <span className="evx-chip">{t("events.composer.voiceChip", { name: previewRoom.name })}</span>
                  )}
                  {gameTag.trim() && <span className="evx-chip">{gameTag.trim()}</span>}
                  {capacity.trim() && <span className="evx-chip">{t("events.composer.spots", { capacity })}</span>}
                  <span className="evx-chip">
                    {audience === "all"
                      ? t("events.composer.audiences.all")
                      : audience === "roles"
                        ? t("events.composer.roleCount", { count: roleIds.length })
                        : t("events.composer.memberCount", { count: memberIds.length })}
                  </span>
                </div>
                {description.trim() && (
                  <p>
                    {description.trim().slice(0, 180)}
                    {description.trim().length > 180 ? "…" : ""}
                  </p>
                )}
              </div>
            </div>
          </aside>
        </div>

        {serverError && (
          <p className="evx-error evx-sheet-error" role="alert">
            {serverError}
          </p>
        )}
        <footer className="evx-sheet-foot">
          {step === 2 ? (
            <button type="button" className="dcx-btn" onClick={() => setStep(1)} disabled={busy}>
              {t("events.composer.back")}
            </button>
          ) : (
            <button type="button" className="dcx-btn" onClick={props.onClose} disabled={busy}>
              {t("events.composer.cancel")}
            </button>
          )}
          {step === 1 ? (
            <button type="button" className="dcx-btn dcx-btn-primary" onClick={goNext}>
              {t("events.composer.next")}
            </button>
          ) : (
            <button type="button" className="dcx-btn dcx-btn-primary" onClick={() => void submit()} disabled={busy}>
              {busy
                ? t("events.composer.saving")
                : editing
                  ? t("events.composer.save")
                  : t("events.composer.createTitle")}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
  return createPortal(body, document.body);
}
