import type { HubEvent, HubEventRsvpStatus } from "../../../shared/hub-events";
import type { AccountSessionGuard, AccountSessionSnapshot } from "../../app/account-session-guard";

export type AuthorizedFetch = (url: string, init?: RequestInit) => Promise<Response>;
export type EventsApiContext = {
  baseUrl: string;
  authorizedFetch: AuthorizedFetch;
  sessionGuard: AccountSessionGuard;
  sessionSnapshot: AccountSessionSnapshot;
  /** Includes Hub role visibility so caches reset when the viewer's roles change. */
  scopeKey: string;
  /** False after the viewer's Hub membership/role map changes, even within one login. */
  isScopeCurrent?: () => boolean;
};

function assertCurrent(ctx: EventsApiContext): void {
  if (!ctx.sessionGuard.owns(ctx.sessionSnapshot) || (ctx.isScopeCurrent && !ctx.isScopeCurrent()))
    throw new Error("This account or Hub access changed. Try again.");
}

export class HubEventApiError extends Error {
  field?: string;
  code?: string;
  status: number;
  constructor(message: string, status: number, field?: string, code?: string) {
    super(message);
    this.status = status;
    this.field = field;
    this.code = code;
  }
}

async function readJson<T>(response: Response): Promise<T> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const data = (body && typeof body === "object" ? body : {}) as { error?: unknown; field?: unknown; code?: unknown };
    throw new HubEventApiError(
      typeof data.error === "string" ? data.error : `Request failed (${response.status})`,
      response.status,
      typeof data.field === "string" ? data.field : undefined,
      typeof data.code === "string" ? data.code : undefined,
    );
  }
  return body as T;
}

const base = (ctx: EventsApiContext, hubId: number) => `${ctx.baseUrl}/api/servers/${hubId}/events`;

export async function listHubEvents(
  ctx: EventsApiContext,
  hubId: number,
  from: number,
  to: number,
  signal?: AbortSignal,
) {
  assertCurrent(ctx);
  const response = await ctx.authorizedFetch(`${base(ctx, hubId)}?from=${Math.floor(from)}&to=${Math.floor(to)}`, {
    signal,
  });
  assertCurrent(ctx);
  const result = await readJson<{ events: HubEvent[]; truncated: boolean; canCreate: boolean }>(response);
  assertCurrent(ctx);
  return result;
}

export type HubEventBody = Partial<{
  title: string;
  description: string;
  coverUrl: string | null;
  startsAt: number;
  endsAt: number | null;
  timezone: string;
  recurrence: HubEvent["recurrence"];
  audience: HubEvent["audience"];
  audienceIds: string[];
  reminderMinutes: number | null;
  capacity: number | null;
  gameTag: string | null;
  channelId: number | null;
  voiceChannelId: number | null;
}>;

export async function createHubEvent(ctx: EventsApiContext, hubId: number, body: HubEventBody) {
  assertCurrent(ctx);
  const response = await ctx.authorizedFetch(base(ctx, hubId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  assertCurrent(ctx);
  const result = await readJson<{ event: HubEvent }>(response);
  assertCurrent(ctx);
  return result.event;
}

export async function updateHubEvent(ctx: EventsApiContext, hubId: number, eventId: string, body: HubEventBody) {
  assertCurrent(ctx);
  const response = await ctx.authorizedFetch(`${base(ctx, hubId)}/${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  assertCurrent(ctx);
  const result = await readJson<{ event: HubEvent }>(response);
  assertCurrent(ctx);
  return result.event;
}

export async function cancelHubEvent(ctx: EventsApiContext, hubId: number, eventId: string) {
  assertCurrent(ctx);
  const response = await ctx.authorizedFetch(`${base(ctx, hubId)}/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
  });
  assertCurrent(ctx);
  const result = await readJson<{ success: true; id: string; cancelledAt: number }>(response);
  assertCurrent(ctx);
  return result;
}

export async function rsvpHubEvent(
  ctx: EventsApiContext,
  hubId: number,
  eventId: string,
  status: HubEventRsvpStatus | null,
) {
  assertCurrent(ctx);
  const response = await ctx.authorizedFetch(`${base(ctx, hubId)}/${encodeURIComponent(eventId)}/rsvp`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  assertCurrent(ctx);
  const result = await readJson<{ event: HubEvent }>(response);
  assertCurrent(ctx);
  return result.event;
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function icsFileName(title: string): string {
  return `${
    title
      .replace(/[^\p{L}\p{N} _-]+/gu, "")
      .trim()
      .slice(0, 60) || "event"
  }.ics`;
}

/** Authenticated .ics download (cookie or bearer) saved through a Blob. */
export async function downloadHubEventIcs(ctx: EventsApiContext, hubId: number, eventId: string, title: string) {
  assertCurrent(ctx);
  const response = await ctx.authorizedFetch(`${base(ctx, hubId)}/${encodeURIComponent(eventId)}/ics`);
  assertCurrent(ctx);
  if (!response.ok) throw new HubEventApiError("Could not download the calendar file.", response.status);
  const blob = await response.blob();
  assertCurrent(ctx);
  saveBlob(blob, icsFileName(title));
}

export function downloadIcsText(text: string, title: string) {
  saveBlob(new Blob([text], { type: "text/calendar;charset=utf-8" }), icsFileName(title));
}
