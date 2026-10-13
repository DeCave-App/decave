import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Trans, useTranslation } from "react-i18next";
import { hubCategoryText } from "../../i18n/hubCategory";
import type { TFunction } from "i18next";
import { Icon } from "../../components/Icon";
import {
  DEFAULT_DISCOVER_FILTERS,
  DISCOVER_SIZES,
  DISCOVER_SORTS,
  categoryCounts,
  filterHubs,
  friendsSummary,
  hasActiveFilters,
  previewRoomSummary,
  type DiscoverFilters,
  type DiscoverHub,
  type HubPreview,
} from "./discoverModel";
import "./discover.css";
import { preferredTimeOptions } from "../../app/locale";
import { formatNumber } from "../../i18n/format";
import { intlLocale } from "../hub-home/intlLocale";

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
  return new Intl.DateTimeFormat(intlLocale(), {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...preferredTimeOptions(),
  }).format(date);
}

/** "Mara and Jun are here", "Mara, Jun and 3 more are here", "2 friends here". */
function friendsText(hub: DiscoverHub, t: TFunction<["discover"]>): string {
  const summary = friendsSummary(hub);
  if (!summary) return "";
  if (summary.kind === "count") return t("discover.friends.count", { count: summary.count });
  if (summary.kind === "one") return t("discover.friends.one", { name: summary.name });
  if (summary.kind === "two") return t("discover.friends.two", { first: summary.first, second: summary.second });
  return t("discover.friends.more", { names: summary.names.join(", "), count: summary.rest });
}

export function DiscoverPage(props: DiscoverPageProps) {
  const { t } = useTranslation(["discover"]);
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
          setPreviewError(error instanceof Error ? error.message : t("discover.preview.loadFailed"));
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
        {t("discover.open")}
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
        {joiningId === hub.id ? t("discover.joining") : t("discover.join")}
      </button>
    );

  const summary = preview ? previewRoomSummary(preview.rooms) : null;
  const sheetHub: DiscoverHub | null = preview ?? previewHub;

  return (
    <section className="dc-workspace-page dc-discover-page dsc-page" aria-label={t("discover.pageLabel")}>
      <div className="dc-discover-shell dsc-shell">
        <header className="dsc-head">
          <div className="dsc-head-copy">
            <span className="ds-kicker">{t("discover.kicker")}</span>
            <h2>{t("discover.title")}</h2>
            <p>
              {t("discover.stats", {
                count: props.hubs.length,
                online: formatNumber(totals.online),
              })}
              {totals.voice ? t("discover.statsVoice", { count: totals.voice }) : ""}
            </p>
          </div>
          <div className="dsc-head-tools">
            <label className="ds-search dsc-search">
              <Icon name="search" size="sm" />
              <input
                className="ds-input"
                type="search"
                placeholder={t("discover.searchPlaceholder")}
                aria-label={t("discover.searchLabel")}
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
                placeholder={t("discover.invitePlaceholder")}
                aria-label={t("discover.inviteLabel")}
              />
              <button type="button" className="ds-btn" onClick={props.onJoinInvite}>
                <Icon name="link" />
                {t("discover.useInvite")}
              </button>
            </div>
            <button
              type="button"
              className="ds-btn ds-btn-ghost ds-icon-btn"
              onClick={props.onRefresh}
              disabled={props.loading}
              aria-label={t("discover.refresh")}
              title={t("discover.refresh")}
            >
              <Icon name="refresh" />
            </button>
          </div>
        </header>

        <div className="dsc-body">
          <aside className="dsc-filters" aria-label={t("discover.filters.label")}>
            <div className="dsc-filter-group">
              <h3>{t("discover.filters.showMe")}</h3>
              <label className={`dsc-toggle${!anyFriends ? " is-disabled" : ""}`}>
                <span>{t("discover.filters.friendsInside")}</span>
                <input
                  type="checkbox"
                  checked={filters.friendsOnly}
                  disabled={!anyFriends && !filters.friendsOnly}
                  onChange={(event) => set("friendsOnly", event.target.checked)}
                />
                <i aria-hidden="true" />
              </label>
              <label className="dsc-toggle">
                <span>{t("discover.filters.activeNow")}</span>
                <input
                  type="checkbox"
                  checked={filters.activeOnly}
                  onChange={(event) => set("activeOnly", event.target.checked)}
                />
                <i aria-hidden="true" />
              </label>
            </div>
            <div className="dsc-filter-group" role="radiogroup" aria-label={t("discover.filters.category")}>
              <h3>{t("discover.filters.category")}</h3>
              <button
                type="button"
                role="radio"
                aria-checked={filters.category === "all"}
                className={`dsc-option${filters.category === "all" ? " is-on" : ""}`}
                onClick={() => set("category", "all")}
              >
                <span>{t("discover.filters.all")}</span>
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
                  <span>{hubCategoryText(category.name)}</span>
                  <small>{category.count}</small>
                </button>
              ))}
            </div>
            <div className="dsc-filter-group" role="radiogroup" aria-label={t("discover.filters.size")}>
              <h3>{t("discover.filters.size")}</h3>
              {DISCOVER_SIZES.map((size) => (
                <button
                  key={size}
                  type="button"
                  role="radio"
                  aria-checked={filters.size === size}
                  className={`dsc-option${filters.size === size ? " is-on" : ""}`}
                  onClick={() => set("size", size)}
                >
                  <span>{t(`discover.size.${size}`)}</span>
                </button>
              ))}
            </div>
            {hasActiveFilters(effectiveFilters) && (
              <button type="button" className="ds-btn ds-btn-ghost ds-btn-sm dsc-clear" onClick={clearFilters}>
                <Icon name="close" size="sm" />
                {t("discover.filters.clear")}
              </button>
            )}
          </aside>

          <div className="dsc-results">
            <div className="dsc-results-head">
              <h3>
                {visible.length === props.hubs.length
                  ? t("discover.results.all")
                  : t("discover.results.some", { shown: visible.length, count: props.hubs.length })}
              </h3>
              <div className="dsc-sort" role="tablist" aria-label={t("discover.sortLabel")}>
                {DISCOVER_SORTS.map((sort) => (
                  <button
                    key={sort}
                    type="button"
                    role="tab"
                    aria-selected={filters.sort === sort}
                    className={filters.sort === sort ? "is-on" : ""}
                    onClick={() => set("sort", sort)}
                  >
                    {t(`discover.sort.${sort}`)}
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
                <p>{t("discover.loading")}</p>
              </div>
            )}

            <div className="dsc-grid">
              {visible.map((hub) => {
                const friends = friendsText(hub, t);
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
                      aria-label={t("discover.card.previewLabel", { name: hub.name })}
                    />
                    <div className="dsc-banner">
                      {hub.bannerUrl ? <img src={props.mediaUrl(hub.bannerUrl)} alt="" /> : <span />}
                      {voice > 0 && (
                        <span className="dsc-live">
                          <i aria-hidden="true" />
                          {t("discover.inVoice", { count: voice })}
                        </span>
                      )}
                      {hub.joined && <span className="dsc-joined">{t("discover.card.joined")}</span>}
                    </div>
                    <div className="dsc-card-body">
                      <div className="dsc-card-top">
                        <HubIcon hub={hub} mediaUrl={props.mediaUrl} className="dsc-icon" />
                        <div>
                          <strong>{hub.name}</strong>
                          <small>{hub.category ? hubCategoryText(hub.category) : t("discover.defaultCategory")}</small>
                        </div>
                      </div>
                      <p>{hub.description || t("discover.noDescription")}</p>
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
                            t("discover.card.membershipPrivate")
                          ) : (
                            <Trans
                              t={t}
                              i18nKey="discover.card.counts"
                              count={n(hub.memberCount)}
                              values={{
                                online: formatNumber(n(hub.onlineCount)),
                                members: formatNumber(n(hub.memberCount)),
                              }}
                              components={{ b: <b /> }}
                            />
                          )}
                        </span>
                        <span className="dsc-card-actions">
                          <button
                            type="button"
                            className="ds-btn ds-btn-ghost ds-btn-sm"
                            onClick={() => setPreviewId(hub.id)}
                          >
                            {t("discover.card.preview")}
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
                <h3>{props.hubs.length ? t("discover.empty.noMatch") : t("discover.empty.quiet")}</h3>
                <p>{props.hubs.length ? t("discover.empty.noMatchHint") : t("discover.empty.quietHint")}</p>
                {props.hubs.length > 0 && (
                  <button type="button" className="ds-btn" onClick={clearFilters}>
                    {t("discover.filters.clear")}
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
            aria-label={
              sheetHub ? t("discover.preview.label", { name: sheetHub.name }) : t("discover.preview.fallbackLabel")
            }
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
                aria-label={t("discover.preview.close")}
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
                    <small>
                      {t("discover.preview.categoryPublic", {
                        category: sheetHub.category
                          ? hubCategoryText(sheetHub.category)
                          : t("discover.defaultCategory"),
                      })}
                    </small>
                  </div>
                </div>
                <p className="dsc-sheet-desc">{sheetHub.description || t("discover.noDescription")}</p>

                <section>
                  <h4>{t("discover.preview.rightNow")}</h4>
                  <ul className="dsc-facts">
                    {!sheetHub.membershipPrivate && (
                      <li>
                        <Icon name="users" size="sm" />
                        {t("discover.preview.counts", {
                          count: n(sheetHub.memberCount),
                          online: formatNumber(n(sheetHub.onlineCount)),
                          members: formatNumber(n(sheetHub.memberCount)),
                        })}
                      </li>
                    )}
                    {n(sheetHub.voiceCount) > 0 && (
                      <li className="live">
                        <Icon name="mic" size="sm" />
                        {t("discover.inVoice", { count: n(sheetHub.voiceCount) })}
                      </li>
                    )}
                    {friendsText(sheetHub, t) && (
                      <li>
                        <Icon name="star" size="sm" />
                        {friendsText(sheetHub, t)}
                      </li>
                    )}
                    {preview?.nextEvent && (
                      <li>
                        <Icon name="calendar" size="sm" />
                        {preview.nextEvent.title} · {formatEvent(preview.nextEvent.startsAt)} ·{" "}
                        {t("discover.preview.going", { count: preview.nextEvent.going })}
                      </li>
                    )}
                  </ul>
                </section>

                <section>
                  <h4>{t("discover.preview.inside")}</h4>
                  {previewError ? (
                    <p className="dsc-muted" role="alert">
                      {previewError}
                    </p>
                  ) : !preview || !summary ? (
                    <p className="dsc-muted">{t("discover.preview.loadingRooms")}</p>
                  ) : (
                    <>
                      <ul className="dsc-facts">
                        <li>
                          <Icon name="hash" size="sm" />
                          {t("discover.preview.chatRooms", { count: summary.text })}
                        </li>
                        {summary.forum > 0 && (
                          <li>
                            <Icon name="forum" size="sm" />
                            {t("discover.preview.forums", { count: summary.forum })} ·{" "}
                            {t("discover.preview.threads", { count: summary.threads })}
                          </li>
                        )}
                        {summary.voice > 0 && (
                          <li>
                            <Icon name="volume" size="sm" />
                            {t("discover.preview.voiceRooms", { count: summary.voice })}
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
                          <span className="dsc-room more">
                            {t("discover.preview.moreRooms", { count: preview.rooms.length - 18 })}
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </section>

                {preview && preview.rules.length > 0 && (
                  <section>
                    <h4>{t("discover.preview.rules")}</h4>
                    <ol className="dsc-rules">
                      {preview.rules.slice(0, 8).map((rule, index) => (
                        <li key={`${index}-${rule}`}>{rule}</li>
                      ))}
                    </ol>
                    {preview.rules.length > 8 && (
                      <p className="dsc-muted">
                        {t("discover.preview.moreRules", { count: preview.rules.length - 8 })}
                      </p>
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
                      {t("discover.preview.openHub")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="ds-btn ds-btn-primary"
                      disabled={joiningId === sheetHub.id}
                      onClick={() => void join(sheetHub.id)}
                    >
                      {joiningId === sheetHub.id ? t("discover.joining") : t("discover.preview.joinHub")}
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
