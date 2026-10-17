// Hub events API (GET/POST /api/servers/:hubId/events, PATCH/DELETE one,
// PUT …/rsvp, GET …/ics), the same calls web makes in src/features/events/api.ts.

import { t } from "i18next";
import { File, Paths } from "expo-file-system";
import type { HubEvent, HubEventRsvpStatus } from "../../../shared/hub-events";
import { API_BASE, apiErrorText, apiFetch } from "./api";

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
  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const data = (body && typeof body === "object" ? body : {}) as { field?: unknown; code?: unknown };
    throw new HubEventApiError(
      apiErrorText(data, t("events.api.requestFailed", { status: response.status })),
      response.status,
      typeof data.field === "string" ? data.field : undefined,
      typeof data.code === "string" ? data.code : undefined,
    );
  }
  return body as T;
}

const base = (hubId: number) => `/api/servers/${hubId}/events`;

export async function listHubEvents(token: string, hubId: number, from: number, to: number) {
  return readJson<{ events: HubEvent[]; truncated: boolean; canCreate: boolean }>(
    await apiFetch(`${base(hubId)}?from=${Math.floor(from)}&to=${Math.floor(to)}`, {}, token),
  );
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

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export async function createHubEvent(token: string, hubId: number, body: HubEventBody): Promise<HubEvent> {
  return (await readJson<{ event: HubEvent }>(await apiFetch(base(hubId), jsonInit("POST", body), token))).event;
}

export async function updateHubEvent(token: string, hubId: number, eventId: string, body: HubEventBody): Promise<HubEvent> {
  return (
    await readJson<{ event: HubEvent }>(
      await apiFetch(`${base(hubId)}/${encodeURIComponent(eventId)}`, jsonInit("PATCH", body), token),
    )
  ).event;
}

export async function cancelHubEvent(token: string, hubId: number, eventId: string): Promise<void> {
  await readJson<unknown>(await apiFetch(`${base(hubId)}/${encodeURIComponent(eventId)}`, { method: "DELETE" }, token));
}

export async function rsvpHubEvent(
  token: string,
  hubId: number,
  eventId: string,
  status: HubEventRsvpStatus | null,
): Promise<HubEvent> {
  return (
    await readJson<{ event: HubEvent }>(
      await apiFetch(`${base(hubId)}/${encodeURIComponent(eventId)}/rsvp`, jsonInit("PUT", { status }), token),
    )
  ).event;
}

export function icsFileName(title: string): string {
  const clean = title.replace(/[^A-Za-z0-9 _-]+/g, "").trim().slice(0, 60);
  return `${clean || "event"}.ics`;
}

/**
 * Downloads the event's .ics into the cache. iOS shares the file (Add to
 * Calendar, Files, ...); Android's share sheet takes the text, as account
 * export does.
 */
export async function downloadHubEventIcs(
  token: string,
  hubId: number,
  eventId: string,
  title: string,
): Promise<{ uri: string; text: string; fileName: string }> {
  const response = await fetch(`${API_BASE}${base(hubId)}/${encodeURIComponent(eventId)}/ics`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new HubEventApiError(t("events.api.icsFailed"), response.status);
  const text = await response.text();
  const fileName = icsFileName(title);
  const file = new File(Paths.cache, fileName);
  if (file.exists) file.delete();
  file.create();
  file.write(text);
  return { uri: file.uri, text, fileName };
}
