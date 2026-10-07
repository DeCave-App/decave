import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Icon } from "../../components/Icon";
import {
  DEFAULT_DISCOVER_FILTERS,
  DISCOVER_SIZE_LABELS,
  DISCOVER_SORT_LABELS,
  categoryCounts,
  filterHubs,
  friendsLine,
  hasActiveFilters,
  previewRoomSummary,
  type DiscoverFilters,
  type DiscoverHub,
  type DiscoverSize,
  type DiscoverSort,
  type HubPreview,
} from "./discoverModel";
import "./discover.css";
import { localeForLanguage, preferredTimeOptions } from "../../app/locale";

export type DiscoverPageProps = {
  hubs: DiscoverHub[];
  loading: boolean;
  error: string;
  query: string;
  onQueryChange: (value: string) => void;
  inviteCode: string;
  onInviteCodeChange: (value: string) => void;
  onJoinInvite: () => void;
  onRefresh: () => void;
  onJoin: (hubId: number) => void | Promise<void>;
  onOpen: (hubId: number) => void;
  loadPreview: (hubId: number, signal: AbortSignal) => Promise<HubPreview>;
  /** Turns a stored media path into a loadable URL. */
  mediaUrl: (path: string) => string;
};

const SORTS: DiscoverSort[] = ["active", "friends", "largest", "new"];
const SIZES: DiscoverSize[] = ["any", "small", "medium", "large"];

function n(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function HubIcon({
  hub,
  mediaUrl,
  className,
}: {
  hub: DiscoverHub;
  mediaUrl: (path: string) => string;
  className: string;
}) {
  return (
    <span className={className} aria-hidden="true">
      {hub.iconUrl ? <img src={mediaUrl(hub.iconUrl)} alt="" /> : hub.icon}
    </span>
  );
}

function formatEvent(startsAt: number): string {
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(localeForLanguage(), {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...preferredTimeOptions(),
  }).format(date);
}

export function DiscoverPage(props: DiscoverPageProps) {
  const [filters, setFilters] = useState<DiscoverFilters>(DEFAULT_DISCOVER_FILTERS);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [preview, setPreview] = useState<HubPreview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [joiningId, setJoiningId] = useState<number | null>(null);
  const sheetRef = useRef<HTMLElement>(null);

  const effectiveFilters = { ...filters, query: props.query };
  const visible = useMemo(() => filterHubs(props.hubs, effectiveFilters), [props.hubs, filters, props.query]);
  const categories = useMemo(() => categoryCounts(props.hubs), [props.hubs]);
  const anyFriends = props.hubs.some((hub) => n(hub.friendsInside) > 0);
  const totals = useMemo(
    () => ({
      online: props.hubs.reduce((sum, hub) => sum + n(hub.onlineCount), 0),
      voice: props.hubs.reduce((sum, hub) => sum + n(hub.voiceCount), 0),
    }),
    [props.hubs],
  );
  const previewHub = previewId === null ? null : (props.hubs.find((hub) => hub.id === previewId) ?? null);

  const set = <K extends keyof DiscoverFilters>(key: K, value: DiscoverFilters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));
  const clearFilters = () => {
    setFilters((current) => ({ ...DEFAULT_DISCOVER_FILTERS, sort: current.sort }));
    props.onQueryChange("");
  };

  // Load the preview for the open sheet.
  useEffect(() => {
    if (previewId === null) return;
    const controller = new AbortController();
    setPreview(null);
    setPreviewError("");
    props
      .loadPreview(previewId, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setPreview(data);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setPreviewError(error instanceof Error ? error.message : "Could not load this Hub.");
      });
    return () => controller.abort();
  }, [previewId]);

  useEffect(() => {
    if (previewId === null) return;
    sheetRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setPreviewId(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [previewId]);

  const join = async (hubId: number) => {
    setJoiningId(hubId);
    try {
      await props.onJoin(hubId);
    } finally {
      setJoiningId(null);
    }
  };

  const actionButton = (hub: DiscoverHub, size: "sm" | "md") =>
    hub.joined ? (
      <button
        type="button"
        className={`ds-btn${size === "sm" ? " ds-btn-sm" : ""}`}
        onClick={(event) => {
          event.stopPropagation();
          props.onOpen(hub.id);
        }}
      >
        Open
      </button>
    ) : (
      <button
        type="button"
        className={`ds-btn ds-btn-primary${size === "sm" ? " ds-btn-sm" : ""}`}
        disabled={joiningId === hub.id}
        onClick={(event) => {
          event.stopPropagation();
          void join(hub.id);
        }}
      >
        {joiningId === hub.id ? "Joining…" : "Join"}
      </button>
    );

  const summary = preview ? previewRoomSummary(preview.rooms) : null;
  const sheetHub: DiscoverHub | null = preview ?? previewHub;

  return (
    <section className="dc-workspace-page dc-discover-page dsc-page" aria-label="Discover Hubs">
      <div className="dc-discover-shell dsc-shell">
        <header className="dsc-head">
          <div className="dsc-head-copy">
            <span className="ds-kicker">Discover</span>
            <h2>Find a Hub worth joining</h2>
            <p>
              {props.hubs.length} public Hubs · {totals.online.toLocaleString()} people online
              {totals.voice ? ` · ${totals.voice} in voice` : ""}
            </p>
          </div>
          <div className="dsc-head-tools">
            <label className="ds-search dsc-search">
              <Icon name="search" size="sm" />
              <input
                className="ds-input"
                type="search"
                placeholder="Search by Hub, category or tag"
                aria-label="Search public Hubs"
                value={props.query}
                onChange={(event) => props.onQueryChange(event.target.value)}
                autoFocus
              />
            </label>
            <div className="dsc-invite">
              <input
                className="ds-input"
                value={props.inviteCode}
                onChange={(event) => props.onInviteCodeChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") props.onJoinInvite();
                }}
                placeholder="Have an invite code?"
                aria-label="Invite code"
              />
              <button type="button" className="ds-btn" onClick={props.onJoinInvite}>
                <Icon name="link" />
                Use invite
              </button>
            </div>
            <button
              type="button"
              className="ds-btn ds-btn-ghost ds-icon-btn"
              onClick={props.onRefresh}
              disabled={props.loading}
              aria-label="Refresh"
              title="Refresh"
            >
              <Icon name="refresh" />
            </button>
          </div>
        </header>

        <div className="dsc-body">
          <aside className="dsc-filters" aria-label="Filters">
            <div className="dsc-filter-group">
              <h3>Show me</h3>
              <label className={`dsc-toggle${!anyFriends ? " is-disabled" : ""}`}>
                <span>Friends inside</span>
                <input
                  type="checkbox"
                  checked={filters.friendsOnly}
                  disabled={!anyFriends && !filters.friendsOnly}
                  onChange={(event) => set("friendsOnly", event.target.checked)}
                />
                <i aria-hidden="true" />
              </label>
              <label className="dsc-toggle">
                <span>Active right now</span>
                <input
                  type="checkbox"
                  checked={filters.activeOnly}
                  onChange={(event) => set("activeOnly", event.target.checked)}
                />
                <i aria-hidden="true" />
              </label>
            </div>
            <div className="dsc-filter-group" role="radiogroup" aria-label="Category">
              <h3>Category</h3>
              <button
                type="button"
                role="radio"
                aria-checked={filters.category === "all"}
                className={`dsc-option${filters.category === "all" ? " is-on" : ""}`}
                onClick={() => set("category", "all")}
              >
                <span>All</span>
                <small>{props.hubs.length}</small>
              </button>
              {categories.map((category) => (
                <button
                  key={category.name}
                  type="button"
                  role="radio"
                  aria-checked={filters.category === category.name}
                  className={`dsc-option${filters.category === category.name ? " is-on" : ""}`}
                  onClick={() => set("category", category.name)}
                >
                  <span>{category.name}</span>
                  <small>{category.count}</small>
                </button>
              ))}
            </div>
            <div className="dsc-filter-group" role="radiogroup" aria-label="Size">
              <h3>Size</h3>
              {SIZES.map((size) => (
                <button
                  key={size}
                  type="button"
                  role="radio"
                  aria-checked={filters.size === size}
                  className={`dsc-option${filters.size === size ? " is-on" : ""}`}
                  onClick={() => set("size", size)}
                >
                  <span>{DISCOVER_SIZE_LABELS[size]}</span>
                </button>
              ))}
            </div>
            {hasActiveFilters(effectiveFilters) && (
              <button type="button" className="ds-btn ds-btn-ghost ds-btn-sm dsc-clear" onClick={clearFilters}>
                <Icon name="close" size="sm" />
                Clear filters
              </button>
            )}
          </aside>

          <div className="dsc-results">
            <div className="dsc-results-head">
              <h3>
                {visible.length === props.hubs.length
                  ? "All public Hubs"
                  : `${visible.length} of ${props.hubs.length} Hubs`}
              </h3>
              <div className="dsc-sort" role="tablist" aria-label="Sort Hubs">
                {SORTS.map((sort) => (
                  <button
                    key={sort}
                    type="button"
                    role="tab"
                    aria-selected={filters.sort === sort}
                    className={filters.sort === sort ? "is-on" : ""}
                    onClick={() => set("sort", sort)}
                  >
                    {DISCOVER_SORT_LABELS[sort]}
                  </button>
                ))}
              </div>
            </div>

            {props.error && (
              <div className="ds-notice dc-discover-notice" role="alert">
                {props.error}
              </div>
            )}
            {props.loading && props.hubs.length === 0 && (
              <div className="ds-empty">
                <p>Loading public Hubs…</p>
              </div>
            )}

            <div className="dsc-grid">
              {visible.map((hub) => {
                const friends = friendsLine(hub);
                const voice = n(hub.voiceCount);
                return (
                  <article
                    key={hub.id}
                    className={`dsc-card${previewId === hub.id ? " is-open" : ""}`}
                    style={{ "--hub-accent": hub.accent || "var(--ds-accent-2)" } as CSSProperties}
                  >
                    <button
                      type="button"
                      className="dsc-card-hit"
                      onClick={() => setPreviewId(hub.id)}
                      aria-label={`Preview ${hub.name}`}
                    />
                    <div className="dsc-banner">
                      {hub.bannerUrl ? <img src={props.mediaUrl(hub.bannerUrl)} alt="" /> : <span />}
                      {voice > 0 && (
                        <span className="dsc-live">
                          <i aria-hidden="true" />
                          {voice} in voice
                        </span>
                      )}
                      {hub.joined && <span className="dsc-joined">Joined</span>}
                    </div>
                    <div className="dsc-card-body">
                      <div className="dsc-card-top">
                        <HubIcon hub={hub} mediaUrl={props.mediaUrl} className="dsc-icon" />
                        <div>
                          <strong>{hub.name}</strong>
                          <small>{hub.category || "Community"}</small>
                        </div>
                      </div>
                      <p>{hub.description || "No description yet."}</p>
                      {friends ? (
                        <div className="dsc-signal friends">
                          <Icon name="users" size="sm" />
                          {friends}
                        </div>
                      ) : (hub.tags ?? []).length > 0 ? (
                        <div className="dsc-tags">
                          {(hub.tags ?? []).slice(0, 4).map((tag) => (
                            <span key={tag}>#{tag}</span>
                          ))}
                        </div>
                      ) : null}
                      <div className="dsc-card-foot">
                        <span>
                          {hub.membershipPrivate ? (
                            "Membership private"
                          ) : (
                            <>
                              <b>{n(hub.onlineCount).toLocaleString()}</b> online ·{" "}
                              {n(hub.memberCount).toLocaleString()} members
                            </>
                          )}
                        </span>
                        <span className="dsc-card-actions">
                          <button
                            type="button"
                            className="ds-btn ds-btn-ghost ds-btn-sm"
                            onClick={() => setPreviewId(hub.id)}
                          >
                            Preview
                          </button>
                          {actionButton(hub, "sm")}
                        </span>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            {!props.loading && visible.length === 0 && (
              <div className="ds-empty">
                <span className="ds-empty-icon">
                  <Icon name="compass" />
                </span>
                <h3>{props.hubs.length ? "No Hubs match these filters" : "Public Hub discovery is quiet"}</h3>
                <p>
                  {props.hubs.length
                    ? "Try another search or clear the filters."
                    : "You can join with an invite code, or create a public Hub and it will show up here."}
                </p>
                {props.hubs.length > 0 && (
                  <button type="button" className="ds-btn" onClick={clearFilters}>
                    Clear filters
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {previewId !== null && (
        <div className="dsc-sheet-scrim" role="presentation" onClick={() => setPreviewId(null)}>
          <aside
            ref={sheetRef}
            className="dsc-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={sheetHub ? `${sheetHub.name} preview` : "Hub preview"}
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
          >
            <div
              className="dsc-sheet-banner"
              style={{ "--hub-accent": sheetHub?.accent || "var(--ds-accent-2)" } as CSSProperties}
            >
              {sheetHub?.bannerUrl && <img src={props.mediaUrl(sheetHub.bannerUrl)} alt="" />}
              <button
                type="button"
                className="ds-btn ds-btn-ghost ds-icon-btn dsc-sheet-close"
                onClick={() => setPreviewId(null)}
                aria-label="Close preview"
              >
                <Icon name="close" />
              </button>
            </div>
            {sheetHub && (
              <div className="dsc-sheet-body">
                <div className="dsc-sheet-id">
                  <HubIcon hub={sheetHub} mediaUrl={props.mediaUrl} className="dsc-sheet-icon" />
                  <div>
                    <strong>{sheetHub.name}</strong>
                    <small>{sheetHub.category || "Community"} · Public</small>
                  </div>
                </div>
                <p className="dsc-sheet-desc">{sheetHub.description || "No description yet."}</p>

                <section>
                  <h4>Right now</h4>
                  <ul className="dsc-facts">
                    {!sheetHub.membershipPrivate && (
                      <li>
                        <Icon name="users" size="sm" />
                        {n(sheetHub.onlineCount).toLocaleString()} online · {n(sheetHub.memberCount).toLocaleString()}{" "}
                        members
                      </li>
                    )}
                    {n(sheetHub.voiceCount) > 0 && (
                      <li className="live">
                        <Icon name="mic" size="sm" />
                        {n(sheetHub.voiceCount)} in voice
                      </li>
                    )}
                    {friendsLine(sheetHub) && (
                      <li>
                        <Icon name="star" size="sm" />
                        {friendsLine(sheetHub)}
                      </li>
                    )}
                    {preview?.nextEvent && (
                      <li>
                        <Icon name="calendar" size="sm" />
                        {preview.nextEvent.title} · {formatEvent(preview.nextEvent.startsAt)} ·{" "}
                        {preview.nextEvent.going} going
                      </li>
                    )}
                  </ul>
                </section>

                <section>
                  <h4>Inside</h4>
                  {previewError ? (
                    <p className="dsc-muted" role="alert">
                      {previewError}
                    </p>
                  ) : !preview || !summary ? (
                    <p className="dsc-muted">Loading rooms…</p>
                  ) : (
                    <>
                      <ul className="dsc-facts">
                        <li>
                          <Icon name="hash" size="sm" />
                          {summary.text} chat room{summary.text === 1 ? "" : "s"}
                        </li>
                        {summary.forum > 0 && (
                          <li>
                            <Icon name="forum" size="sm" />
                            {summary.forum} forum{summary.forum === 1 ? "" : "s"} · {summary.threads} thread
                            {summary.threads === 1 ? "" : "s"}
                          </li>
                        )}
                        {summary.voice > 0 && (
                          <li>
                            <Icon name="volume" size="sm" />
                            {summary.voice} voice room{summary.voice === 1 ? "" : "s"}
                          </li>
                        )}
                      </ul>
                      <div className="dsc-rooms">
                        {preview.rooms.slice(0, 18).map((room) => (
                          <span
                            key={room.id}
                            className={`dsc-room dsc-room--${room.type}${room.voiceCount > 0 ? " is-live" : ""}`}
                          >
                            <span aria-hidden="true">
                              {room.icon || (room.type === "voice" ? "🔊" : room.type === "forum" ? "🗂️" : "#")}
                            </span>
                            {room.name}
                            {room.voiceCount > 0 && <small>{room.voiceCount}</small>}
                          </span>
                        ))}
                        {preview.rooms.length > 18 && (
                          <span className="dsc-room more">+{preview.rooms.length - 18} more</span>
                        )}
                      </div>
                    </>
                  )}
                </section>

                {preview && preview.rules.length > 0 && (
                  <section>
                    <h4>Rules</h4>
                    <ol className="dsc-rules">
                      {preview.rules.slice(0, 8).map((rule, index) => (
                        <li key={`${index}-${rule}`}>{rule}</li>
                      ))}
                    </ol>
                    {preview.rules.length > 8 && (
                      <p className="dsc-muted">+{preview.rules.length - 8} more after you join</p>
                    )}
                  </section>
                )}

                {(sheetHub.tags ?? []).length > 0 && (
                  <div className="dsc-tags">
                    {(sheetHub.tags ?? []).slice(0, 8).map((tag) => (
                      <span key={tag}>#{tag}</span>
                    ))}
                  </div>
                )}

                <div className="dsc-sheet-actions">
                  {sheetHub.joined ? (
                    <button type="button" className="ds-btn ds-btn-primary" onClick={() => props.onOpen(sheetHub.id)}>
                      Open Hub
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="ds-btn ds-btn-primary"
                      disabled={joiningId === sheetHub.id}
                      onClick={() => void join(sheetHub.id)}
                    >
                      {joiningId === sheetHub.id ? "Joining…" : "Join Hub"}
                    </button>
                  )}
                </div>
              </div>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}
