// Polls, hub events and forms.

import { BOT_LIMITS } from "../../../shared/bots/types";
import { hasPermission } from "../../db";
import { realtimeBroadcast } from "../../lib/realtime";
import { takeBudget } from "../limits";
import { refusal } from "../reasons";
import { guardPublisher, guardRoom, refused } from "./guard";
import { postFromBot, render } from "./messages";
import { registerAction } from "./registry";

const POLL_PREFIX = "__DECAVE_POLL__";
const MAX_POLL_OPTIONS = 10;
const MAX_UPCOMING_EVENTS = 500;

registerAction("startPoll", {
  capability: "create_polls",
  async run(ctx, action) {
    if (action.type !== "startPoll") return { ok: true };
    const room = await guardRoom(ctx, "trigger");
    if (refused(room)) return { ok: false, reason: room.reason, notice: room.notice };
    const question = render(ctx, action.question).trim().slice(0, 300);
    const options = action.options
      .map((option) => render(ctx, option).trim().slice(0, 80))
      .filter(Boolean)
      .slice(0, MAX_POLL_OPTIONS);
    if (!question || options.length < 2) return { ok: false, ...refusal("bots.run.server.pollIncomplete") };
    if (ctx.dryRun) return { ok: true };
    if (!takeBudget(ctx.event.hubId, "messages")) return { ok: false, ...refusal("bots.run.server.messageLimit") };
    // Stored unwrapped so clients render and count votes like any poll; bot_id marks the author.
    return postFromBot(ctx, room, `${POLL_PREFIX}${JSON.stringify({ question, options })}`, { raw: true });
  },
});

registerAction("createEvent", {
  capability: "create_events",
  async run(ctx, action) {
    if (action.type !== "createEvent") return { ok: true };
    const room = await guardRoom(ctx, "trigger");
    if (refused(room)) return { ok: false, reason: room.reason, notice: room.notice };
    // Mirrors the hub events route: Manage Events is required.
    if (!(await hasPermission(ctx.env.DB, ctx.event.hubId, ctx.publishedBy, "manageEvents")))
      return { ok: false, ...refusal("bots.run.server.publisherCantCreateEvents") };
    const title = render(ctx, action.title).replace(/\s+/g, " ").trim().slice(0, 100);
    if (!title) return { ok: false, ...refusal("bots.run.server.eventTitleEmpty") };
    const startsIn = Math.trunc(action.startsInMinutes);
    const duration = Math.trunc(action.durationMinutes);
    if (!(startsIn >= 0) || !(duration > 0)) return { ok: false, ...refusal("bots.run.server.eventTimesInvalid") };
    if (ctx.dryRun) return { ok: true };
    const db = ctx.env.DB;
    const now = Date.now();
    const upcoming = await db
      .prepare(
        "SELECT COUNT(*) AS n FROM decave_hub_events WHERE hub_id=? AND cancelled_at IS NULL AND (recurrence<>'none' OR starts_at > ?)",
      )
      .bind(ctx.event.hubId, now)
      .first<{ n: number }>();
    if (Number(upcoming?.n ?? 0) >= MAX_UPCOMING_EVENTS)
      return { ok: false, ...refusal("bots.run.server.tooManyEvents") };
    const startsAt = now + startsIn * 60_000;
    const eventId = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO decave_hub_events(id,hub_id,channel_id,title,description,starts_at,ends_at,timezone,recurrence,audience,audience_ids_json,created_by,created_at,updated_at)
         VALUES(?,?,?,?,'',?,?,'UTC','none','all','[]',?,?,?)`,
      )
      .bind(eventId, ctx.event.hubId, room.id, title, startsAt, startsAt + duration * 60_000, ctx.publishedBy, now, now)
      .run();
    await realtimeBroadcast(
      ctx.env,
      { type: "HUB_EVENTS_CHANGED", serverId: ctx.event.hubId, eventId, action: "created" },
      { hubId: ctx.event.hubId },
    );
    return { ok: true };
  },
});

registerAction("openForm", {
  capability: null,
  async run(ctx, action) {
    if (action.type !== "openForm") return { ok: true };
    const publisher = await guardPublisher(ctx);
    if (refused(publisher)) return { ok: false, reason: publisher.reason, notice: publisher.notice };
    if (!ctx.interaction) return { ok: false, ...refusal("bots.run.server.formsNeedInteraction") };
    if (!ctx.dryRun)
      ctx.interaction.form = {
        formId: action.formId,
        title: action.title,
        fields: action.fields.slice(0, BOT_LIMITS.formMaxFields),
      };
    return { ok: true };
  },
});
