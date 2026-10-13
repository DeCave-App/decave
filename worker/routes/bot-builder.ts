// No-code bot builder management API: bots, rule drafts, publish, run log,
// export/import, test runs and AI ("describe it") rule drafts. Everything needs Manage Bots on the hub.

import { BOT_LIMITS } from "../../shared/bots/types";
import type { BotCard, BotFormField, BotRule } from "../../shared/bots/types";
import { validateRule, type BotRuleError } from "../../shared/bots/schema";
import { mapRuleIds } from "../../shared/bots/ids";
import { TEMPLATES, BUILT_IN_COMMANDS } from "../../shared/bots/templates";
import { TRIGGER_TYPES } from "../../shared/bots/catalogue";
import { capabilitiesForRules } from "../../shared/bots/capabilities";
import { DESCRIPTION_MAX, generateRules, utcDay } from "../bots/ai";
import { dispatchBotEvent, invalidateHubRules, type BotEvent, type BotInteractionResponse } from "../bots/engine";
import { botsEnabled } from "../bots/flags";
import { syncBotSchedules } from "../bots/timers";
import {
  BotStoreError,
  type BotRow,
  aiUsageOn,
  createBuilderBot,
  deleteBot,
  deleteRule,
  getBot,
  hasPendingStructureChanges,
  listBots,
  listDraftRules,
  listRuns,
  publishBot,
  reorderRules,
  saveRuleDraft,
  setRuleEnabled,
  updateBotSettings,
} from "../bots/store";
import { audit, getRole, getRoom, hasPermission } from "../db";
import { canAccessRoom } from "../lib/hubs";
import { boundedBodyJson, idFromPath, json, apiError, apiErrorLegacy } from "../lib/http";
import { requireUser } from "../lib/sessions";
import {
  normalizeHubBotCapabilities,
  storedHubBotCapabilities,
  storedHubBotRoomIds,
  validateHubBotRoomIds,
} from "../lib/hub-bots";
import type { ApiContext } from "./context";

const NO_STORE = { "Cache-Control": "no-store, private" };
const BODY_LIMIT = 16 * 1024;
const IMPORT_LIMIT = 256 * 1024;
// Stands in for an empty ("pick it later") id while a draft is checked.
const BLANK = "\u0001blank";

const reply = (data: unknown, status = 200) => json(data, status, NO_STORE);
const tooLarge = () => apiError("botBuilder.bodyTooLarge", 413, undefined, NO_STORE);

type Hub = {
  channels: { id: string; name: string }[];
  voice: { id: string; name: string }[];
  roles: { id: string; name: string }[];
};

async function loadHub(db: D1Database, hubId: number): Promise<Hub> {
  const rooms = await db
    .prepare("SELECT id,name FROM decave_rooms WHERE hub_id=? AND type='text' ORDER BY position,id")
    .bind(hubId)
    .all<{ id: number; name: string }>();
  const voice = await db
    .prepare("SELECT id,name FROM decave_rooms WHERE hub_id=? AND type='voice' ORDER BY position,id")
    .bind(hubId)
    .all<{ id: number; name: string }>();
  const roles = await db
    .prepare("SELECT id,name FROM decave_custom_roles WHERE hub_id=? ORDER BY position,created_at")
    .bind(hubId)
    .all<{ id: string; name: string }>();
  return {
    channels: rooms.results.map((r) => ({ id: String(r.id), name: r.name })),
    voice: voice.results.map((r) => ({ id: String(r.id), name: r.name })),
    roles: roles.results.map((r) => ({ id: String(r.id), name: r.name })),
  };
}

function ruleContext(hub: Hub, ruleIds: string[], allowBlank: boolean) {
  const extra = allowBlank ? [BLANK] : [];
  return {
    channelIds: new Set([...hub.channels.map((c) => c.id), ...extra]),
    voiceRoomIds: new Set([...hub.voice.map((c) => c.id), ...extra]),
    roleIds: new Set([...hub.roles.map((r) => r.id), ...extra]),
    ruleIds: new Set([...ruleIds, ...extra]),
    builtInCommands: new Set(BUILT_IN_COMMANDS),
  };
}

type Checked = { ok: true; rule: BotRule } | { ok: false; errors: BotRuleError[] };

/**
 * Validates a rule. With allowBlank, empty ids (templates and imports that need
 * the admin to pick something) pass as drafts and are kept empty; publish
 * checks again with allowBlank off, so such a bot cannot go live half-filled.
 */
function checkRule(input: unknown, hub: Hub, ruleIds: string[], allowBlank = false): Checked {
  const blank = (id: string) => (id === "" ? BLANK : id);
  const unblank = (id: string) => (id === BLANK ? "" : id);
  const prepared =
    allowBlank && input && typeof input === "object"
      ? mapRuleIds(input as BotRule, { channel: blank, voice: blank, role: blank, rule: blank })
      : input;
  const result = validateRule(prepared, ruleContext(hub, ruleIds, allowBlank));
  if (!result.ok) return result;
  return {
    ok: true,
    rule: allowBlank
      ? mapRuleIds(result.rule, { channel: unblank, voice: unblank, role: unblank, rule: unblank })
      : result.rule,
  };
}

async function clientBot(db: D1Database, row: BotRow) {
  const rules =
    row.kind === "builder"
      ? (await listDraftRules(db, row.id)).map((r) => ({
          id: r.ruleId,
          enabled: r.enabled,
          draft: r.draft,
          published: r.published,
        }))
      : [];
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    description: row.description,
    color: row.color,
    avatarEmoji: row.avatar_emoji,
    enabled: row.enabled === 1,
    // Set when the engine turned the bot off after too many failed runs in a row.
    pausedReason:
      row.kind === "builder" && row.enabled !== 1 && Number(row.failure_streak) >= BOT_LIMITS.autoPauseFailures
        ? ("errors" as const)
        : null,
    capabilities: storedHubBotCapabilities(row.capabilities),
    allowedRoomIds: storedHubBotRoomIds(row.allowed_room_ids),
    hasUnpublishedChanges:
      rules.some((r) => !r.published || JSON.stringify(r.draft) !== JSON.stringify(r.published)) ||
      (row.kind === "builder" && (await hasPendingStructureChanges(db, row.id))),
    rules,
    createdAt: row.created_at,
  };
}

const cleanText = (value: unknown, max: number): string =>
  typeof value === "string"
    ? value
        .normalize("NFC")
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .trim()
        .slice(0, max)
    : "";

async function builderBot(db: D1Database, hubId: number, botId: string): Promise<BotRow | null> {
  const bot = await getBot(db, hubId, botId);
  return bot && bot.kind === "builder" ? bot : null;
}

const notFound = () => apiError("common.botNotFound", 404, undefined, NO_STORE);

// Interactions: card buttons/selects, form submits, the composer's command list.

const FORM_TTL_MS = 15 * 60_000;
const FIELD_MAX_CHARS = 1000;

type InteractionForm = NonNullable<BotInteractionResponse["form"]>;

async function rememberForm(db: D1Database, hubId: number, roomId: number, userId: string, form: InteractionForm) {
  await db
    .prepare(
      `INSERT OR REPLACE INTO decave_bot_pending_forms(hub_id,room_id,user_id,form_id,title,fields_json,expires_at)
       VALUES(?,?,?,?,?,?,?)`,
    )
    .bind(hubId, roomId, userId, form.formId, form.title, JSON.stringify(form.fields), Date.now() + FORM_TTL_MS)
    .run();
}

async function answerInteraction(env: ApiContext["env"], event: BotEvent, roomId: number, userId: string) {
  const interaction: BotInteractionResponse = {};
  try {
    await dispatchBotEvent(env, event, { interaction });
  } catch (error) {
    console.error("bot interaction failed", error);
    return reply({ ok: true });
  }
  if (!interaction.form) return reply({ ok: true });
  await rememberForm(env.DB, event.hubId, roomId, userId, interaction.form);
  return reply({ ok: true, form: interaction.form });
}

/** The card's button ids and select (id -> allowed values) on a builder-bot message. */
function cardControls(cardJson: string | null): { buttons: Set<string>; select: Map<string, Set<string>> } {
  const controls = { buttons: new Set<string>(), select: new Map<string, Set<string>>() };
  if (!cardJson) return controls;
  try {
    const card = JSON.parse(cardJson) as BotCard;
    for (const button of card.buttons ?? [])
      if (typeof button?.customId === "string") controls.buttons.add(button.customId);
    if (card.select && typeof card.select.customId === "string")
      controls.select.set(card.select.customId, new Set((card.select.options ?? []).map((o) => String(o.value))));
  } catch {
    /* no controls */
  }
  return controls;
}

async function handleBotInteractionRoutes({ request, env, p, method }: ApiContext): Promise<Response | null> {
  const interactionMatch = method === "POST" ? idFromPath(p, /^\/api\/rooms\/(\d+)\/bot-interactions$/) : null;
  const formMatch = method === "POST" ? idFromPath(p, /^\/api\/rooms\/(\d+)\/bot-forms\/([^/]+)$/) : null;
  const commandsMatch = method === "GET" ? idFromPath(p, /^\/api\/servers\/(\d+)\/bot-commands$/) : null;
  if (!interactionMatch && !formMatch && !commandsMatch) return null;
  if (!botsEnabled(env)) return apiError("common.notFound", 404, undefined, NO_STORE);
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;
  const db = env.DB;

  if (commandsMatch) {
    const hubId = Number(commandsMatch[1]);
    if (!(await getRole(db, hubId, user.id))) return apiError("common.notHubMember", 403, undefined, NO_STORE);
    const rows = await db
      .prepare(
        `SELECT c.name,c.bot_id,b.name AS bot_name,r.published_json FROM decave_bot_commands c
         JOIN decave_hub_bots b ON b.id=c.bot_id AND b.hub_id=c.hub_id
         JOIN decave_bot_rules r ON r.id=c.rule_id
         WHERE c.hub_id=? AND b.enabled=1 AND r.enabled=1 AND r.published_json IS NOT NULL ORDER BY c.name`,
      )
      .bind(hubId)
      .all<{ name: string; bot_id: string; bot_name: string; published_json: string }>();
    const commands = rows.results.flatMap((row) => {
      try {
        const rule = JSON.parse(row.published_json) as BotRule;
        if (rule.trigger.type !== "command") return [];
        return [{ name: row.name, botId: row.bot_id, botName: row.bot_name, options: rule.trigger.options ?? [] }];
      } catch {
        return [];
      }
    });
    return reply({ commands });
  }

  const roomId = Number((interactionMatch ?? formMatch)![1]);
  const room = await getRoom(db, roomId);
  // Hub rooms only: DMs and group chats have no hub room id.
  if (!room || !room.hub_id || !(await getRole(db, room.hub_id, user.id)) || !(await canAccessRoom(db, room, user.id)))
    return apiError("botBuilder.roomNotFound", 404, undefined, NO_STORE);
  const hubId = Number(room.hub_id);
  const body = await boundedBodyJson(request, BODY_LIMIT);
  if (!body) return tooLarge();

  if (interactionMatch) {
    const messageId = typeof body.messageId === "string" ? body.messageId.slice(0, 64) : "";
    const customId = typeof body.customId === "string" ? body.customId.slice(0, 100) : "";
    const value = typeof body.value === "string" ? body.value : undefined;
    // Option values are at most 100 characters (checked when the rule is saved).
    if (value !== undefined && value.length > 100) return apiError("botBuilder.valueTooLong", 400, undefined, NO_STORE);
    if (!messageId || !customId) return apiError("botBuilder.controlIdsRequired", 400, undefined, NO_STORE);
    const message = await db
      .prepare(
        `SELECT m.card_json FROM decave_messages m JOIN decave_hub_bots b ON b.id=m.bot_id AND b.kind='builder'
         WHERE m.id=? AND m.room_id=? AND m.hub_id=? AND (m.visible_to_user_id IS NULL OR m.visible_to_user_id=?)`,
      )
      .bind(messageId, roomId, hubId, user.id)
      .first<{ card_json: string | null }>();
    if (!message) return apiError("botBuilder.messageNotFound", 404, undefined, NO_STORE);
    const controls = cardControls(message.card_json);
    const options = controls.select.get(customId);
    const valid = options ? value !== undefined && options.has(value) : controls.buttons.has(customId);
    if (!valid) return apiError("botBuilder.controlNotOnMessage", 400, undefined, NO_STORE);
    const event: BotEvent = {
      hubId,
      roomId,
      kind: "component",
      actorId: user.id,
      actorIsBot: false,
      chainDepth: 0,
      data: { customId, value: value ?? "", messageId },
    };
    return answerInteraction(env, event, roomId, user.id);
  }

  const formId = decodeURIComponent(formMatch![2]).slice(0, 100);
  const fields = body.fields;
  if (!fields || typeof fields !== "object" || Array.isArray(fields))
    return apiError("botBuilder.fieldsInvalid", 400, undefined, NO_STORE);
  const entries = Object.entries(fields as Record<string, unknown>);
  if (entries.length > BOT_LIMITS.formMaxFields)
    return apiError("botBuilder.formTooManyFields", 400, { max: BOT_LIMITS.formMaxFields }, NO_STORE);
  const open = await db
    .prepare(
      "SELECT fields_json,expires_at FROM decave_bot_pending_forms WHERE hub_id=? AND room_id=? AND user_id=? AND form_id=?",
    )
    .bind(hubId, roomId, user.id, formId)
    .first<{ fields_json: string; expires_at: number }>();
  if (!open || Number(open.expires_at) < Date.now())
    return apiError("botBuilder.formNotOpen", 404, undefined, NO_STORE);
  let declared: BotFormField[] = [];
  try {
    declared = JSON.parse(open.fields_json) as BotFormField[];
  } catch {
    declared = [];
  }
  const known = new Set(declared.map((field) => field.id));
  const values: Record<string, string> = {};
  for (const [id, raw] of entries) {
    if (!known.has(id)) return apiError("botBuilder.unknownField", 400, { id }, NO_STORE);
    if (typeof raw !== "string" || raw.length > FIELD_MAX_CHARS)
      return apiError("botBuilder.fieldTooLong", 400, { id, max: FIELD_MAX_CHARS }, NO_STORE);
    values[id] = raw;
  }
  for (const field of declared)
    if (field.required && !values[field.id]?.trim())
      return apiError("botBuilder.fieldRequired", 400, { label: field.label }, NO_STORE);
  // Claim the form atomically. The earlier SELECT is for field validation;
  // this conditional DELETE decides which concurrent submitter owns it.
  const claimed = await db
    .prepare(
      "DELETE FROM decave_bot_pending_forms WHERE hub_id=? AND room_id=? AND user_id=? AND form_id=? AND expires_at>=?",
    )
    .bind(hubId, roomId, user.id, formId, Date.now())
    .run();
  if (claimed.meta.changes !== 1) return apiError("botBuilder.formNotOpen", 404, undefined, NO_STORE);
  const event: BotEvent = {
    hubId,
    roomId,
    kind: "formSubmit",
    actorId: user.id,
    actorIsBot: false,
    chainDepth: 0,
    data: { formId, fields: values },
  };
  return answerInteraction(env, event, roomId, user.id);
}

/** The Hub has DeCave's custom Twitch features switched on (Streamer community_features). */
async function hubHasTwitch(db: D1Database, hubId: number): Promise<boolean> {
  try {
    const row = await db
      .prepare("SELECT json_extract(community_features,'$.twitch') AS on_ FROM decave_streamer_hubs WHERE hub_id=?")
      .bind(hubId)
      .first<{ on_: number | null }>();
    return row?.on_ === 1;
  } catch {
    return false;
  }
}

export async function handleBotBuilderRoutes(context: ApiContext): Promise<Response | null> {
  const interaction = await handleBotInteractionRoutes(context);
  if (interaction) return interaction;
  const { request, env, p, method, url } = context;
  const match = idFromPath(
    p,
    /^\/api\/servers\/(\d+)\/bot-builder(?:\/(import|generate)|\/([^/]+)(?:\/(publish|runs|export|test)|\/rules\/([^/]+))?)?$/,
  );
  if (!match) return null;
  if (!botsEnabled(env)) return apiError("common.notFound", 404, undefined, NO_STORE);

  const hubId = Number(match[1]);
  const isImport = match[2] === "import";
  const isGenerate = match[2] === "generate";
  // Without a provider key the AI helper does not exist.
  if (isGenerate && !env.ANTHROPIC_API_KEY) return apiError("common.notFound", 404, undefined, NO_STORE);
  const botId = isImport || isGenerate ? undefined : match[3] ? decodeURIComponent(match[3]) : undefined;
  const sub = match[4];
  const ruleRef = match[5] ? decodeURIComponent(match[5]) : undefined;

  const user = await requireUser(request, env);
  if (user instanceof Response) return user;
  if (!(await hasPermission(env.DB, hubId, user.id, "manageBots")))
    return apiError("botBuilder.manageBotsRequired", 403, undefined, NO_STORE);
  const db = env.DB;

  // /bot-builder/generate
  if (isGenerate) {
    if (method !== "POST") return null;
    const body = await boundedBodyJson(request, BODY_LIMIT);
    if (!body) return tooLarge();
    return generateForHub(env, hubId, body);
  }

  // /bot-builder
  if (!isImport && !botId) {
    if (method === "GET") {
      const bots = await Promise.all((await listBots(db, hubId)).map((row) => clientBot(db, row)));
      const aiAvailable = Boolean(env.ANTHROPIC_API_KEY);
      const twitchEnabled = await hubHasTwitch(db, hubId);
      const used = aiAvailable ? await aiUsageOn(db, hubId, utcDay()) : 0;
      return reply({
        bots,
        // Twitch live alerts only where DeCave staff switched Twitch on for the Hub.
        templates: TEMPLATES.filter((t) => t.id !== "liveAlerts" || twitchEnabled).map(({ id, name, description }) => ({
          id,
          name,
          description,
        })),
        aiAvailable,
        aiRemainingToday: aiAvailable ? Math.max(0, BOT_LIMITS.aiPerDay - used) : 0,
      });
    }
    if (method === "POST") {
      const body = await boundedBodyJson(request, BODY_LIMIT);
      if (!body) return tooLarge();
      const name = cleanText(body.name, 32);
      if (!name) return apiError("common.botNameRequired", 400, undefined, NO_STORE);
      const found = body.templateId === undefined ? null : TEMPLATES.find((t) => t.id === body.templateId);
      const template =
        found?.id === "liveAlerts" && !(await hubHasTwitch(db, hubId))
          ? undefined
          : (found ?? (found === null ? null : undefined));
      if (template === undefined) return apiError("botBuilder.unknownTemplate", 400, undefined, NO_STORE);
      try {
        const bot = await createBuilderBot(db, {
          hubId,
          name,
          description: cleanText(body.description, 180),
          createdBy: user.id,
        });
        if (template) {
          const hub = await loadHub(db, hubId);
          const first = await db
            .prepare(
              "SELECT id FROM decave_rooms WHERE hub_id=? AND type='text' AND kind='chat' ORDER BY position,id LIMIT 1",
            )
            .bind(hubId)
            .first<{ id: number }>();
          const saved: BotRule[] = [];
          for (const rule of template.rules({ firstTextRoomId: first ? String(first.id) : "" })) {
            const checked = checkRule(rule, hub, [], true);
            if (checked.ok) {
              await saveRuleDraft(db, bot.id, null, checked.rule, user.id);
              saved.push(checked.rule);
            }
          }
          await grantRuleCapabilities(db, hubId, bot.id, saved);
        }
        await audit(db, hubId, user.id, "bot.create", bot.id, name);
        return reply(await clientBot(db, (await getBot(db, hubId, bot.id)) ?? bot), 201);
      } catch (error) {
        if (error instanceof BotStoreError && error.code === "BOT_LIMIT")
          return apiErrorLegacy(
            error.code,
            "botBuilder.botLimit",
            409,
            { max: BOT_LIMITS.botsPerHub },
            undefined,
            NO_STORE,
          );
        throw error;
      }
    }
    return null;
  }

  // /bot-builder/import
  if (isImport) {
    if (method !== "POST") return null;
    const body = await boundedBodyJson(request, IMPORT_LIMIT);
    if (!body) return tooLarge();
    return importBot(env, hubId, user.id, body);
  }

  if (!botId) return null;
  const bot = await builderBot(db, hubId, botId);
  if (!bot) return notFound();

  // /bot-builder/:botId
  if (!sub && !ruleRef) {
    if (method === "DELETE") {
      await deleteBot(db, hubId, botId);
      invalidateHubRules(hubId);
      await audit(db, hubId, user.id, "bot.delete", botId, bot.name);
      return reply({ success: true });
    }
    if (method === "PATCH") {
      const body = await boundedBodyJson(request, BODY_LIMIT);
      if (!body) return tooLarge();
      const patch: Parameters<typeof updateBotSettings>[3] = {};
      if (body.name !== undefined) {
        patch.name = cleanText(body.name, 32);
        if (!patch.name) return apiError("common.botNameRequired", 400, undefined, NO_STORE);
      }
      if (body.description !== undefined) patch.description = cleanText(body.description, 180);
      if (body.color !== undefined) {
        if (typeof body.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(body.color))
          return apiError("botBuilder.colorInvalid", 400, undefined, NO_STORE);
        patch.color = body.color;
      }
      if (body.avatarEmoji !== undefined) {
        if (typeof body.avatarEmoji !== "string" || body.avatarEmoji.length > 16)
          return apiError("botBuilder.avatarEmojiInvalid", 400, undefined, NO_STORE);
        patch.avatarEmoji = body.avatarEmoji;
      }
      if (body.enabled !== undefined) {
        if (typeof body.enabled !== "boolean") return apiError("common.enabledNotBoolean", 400, undefined, NO_STORE);
        patch.enabled = body.enabled;
      }
      if (body.capabilities !== undefined) {
        patch.capabilities = normalizeHubBotCapabilities(body.capabilities, []);
        if (!Array.isArray(body.capabilities) || !patch.capabilities.length)
          return apiError("common.botActionRequired", 400, undefined, NO_STORE);
      }
      if (body.allowedRoomIds !== undefined) {
        const rooms = await validateHubBotRoomIds(db, hubId, user.id, body.allowedRoomIds);
        if (!rooms) return apiError("botBuilder.allowedRoomsInvalid", 400, undefined, NO_STORE);
        patch.allowedRoomIds = rooms;
      }
      const updated = await updateBotSettings(db, hubId, botId, patch);
      if (!updated) return notFound();
      invalidateHubRules(hubId);
      await audit(db, hubId, user.id, "bot.update", botId, updated.name);
      return reply(await clientBot(db, updated));
    }
    return null;
  }

  if (sub === "publish" && method === "POST") {
    const hub = await loadHub(db, hubId);
    const drafts = await listDraftRules(db, botId);
    const ids = drafts.map((d) => d.ruleId);
    const errors: (BotRuleError & { ruleId: string })[] = [];
    for (const { ruleId, draft } of drafts) {
      const checked = checkRule(draft, hub, ids);
      if (!checked.ok) errors.push(...checked.errors.map((e) => ({ ruleId, ...e })));
    }
    if (errors.length) return reply({ errors }, 400);
    try {
      await publishBot(db, botId, user.id);
      invalidateHubRules(hubId);
    } catch (error) {
      if (error instanceof BotStoreError) {
        if (error.code === "COMMAND_LIMIT")
          return apiErrorLegacy(
            error.code,
            "botBuilder.commandLimit",
            400,
            { max: BOT_LIMITS.commandsPerHub },
            undefined,
            NO_STORE,
          );
        if (error.code === "BOT_COMMAND_TAKEN")
          return apiErrorLegacy(error.code, "botBuilder.commandTaken", 409, undefined, undefined, NO_STORE);
      }
      throw error;
    }
    await audit(db, hubId, user.id, "bot.publish", botId, bot.name);
    // Schedules restart from the new rules; a failure here never undoes the publish.
    await syncBotSchedules(env, hubId, botId).catch((error) => console.error("bot schedule sync failed", error));
    return reply(await clientBot(db, (await getBot(db, hubId, botId)) ?? bot));
  }

  if (sub === "test" && method === "POST") {
    const body = await boundedBodyJson(request, BODY_LIMIT);
    if (!body) return tooLarge();
    return testRun(env, hubId, bot, user.id, body);
  }

  if (sub === "runs" && method === "GET") {
    return reply({ runs: await listRuns(db, botId, { errorsOnly: url.searchParams.get("errors") === "1" }) });
  }

  if (sub === "export" && method === "GET") {
    const hub = await loadHub(db, hubId);
    const drafts = await listDraftRules(db, botId);
    const channelName = new Map(hub.channels.map((c) => [c.id, `#${c.name}`]));
    const voiceName = new Map(hub.voice.map((c) => [c.id, `~${c.name}`]));
    const roleName = new Map(hub.roles.map((r) => [r.id, `@${r.name}`]));
    const ruleIndex = new Map(drafts.map((d, i) => [d.ruleId, `rule:${i}`]));
    return reply({
      v: 1,
      name: bot.name,
      description: bot.description,
      color: bot.color,
      avatarEmoji: bot.avatar_emoji,
      rules: drafts.map((d) =>
        mapRuleIds(d.draft, {
          channel: (id) => channelName.get(id) ?? "",
          voice: (id) => voiceName.get(id) ?? "",
          role: (id) => roleName.get(id) ?? "",
          rule: (id) => ruleIndex.get(id) ?? "",
        }),
      ),
    });
  }

  if (ruleRef) {
    if (ruleRef === "order" && method === "POST") {
      const body = await boundedBodyJson(request, BODY_LIMIT);
      if (!body) return tooLarge();
      const known = new Set((await listDraftRules(db, botId)).map((r) => r.ruleId));
      const ids = body.ruleIds;
      if (
        !Array.isArray(ids) ||
        ids.length !== known.size ||
        new Set(ids).size !== ids.length ||
        !ids.every((id) => known.has(id))
      )
        return apiError("botBuilder.ruleOrderInvalid", 400, undefined, NO_STORE);
      await reorderRules(db, botId, ids as string[]);
      await audit(db, hubId, user.id, "bot.rules.order", botId, bot.name);
      return reply({ success: true });
    }
    if (method === "PATCH") {
      const body = await boundedBodyJson(request, BODY_LIMIT);
      if (!body) return tooLarge();
      if (typeof body.enabled !== "boolean") return apiError("common.enabledNotBoolean", 400, undefined, NO_STORE);
      if (!(await setRuleEnabled(db, botId, ruleRef, body.enabled)))
        return apiError("botBuilder.ruleNotFound", 404, undefined, NO_STORE);
      invalidateHubRules(hubId);
      await audit(db, hubId, user.id, body.enabled ? "bot.rule.resume" : "bot.rule.pause", botId, bot.name);
      return reply({ success: true, enabled: body.enabled });
    }
    if (method === "PUT") {
      const body = await boundedBodyJson(request, BODY_LIMIT);
      if (!body) return tooLarge();
      const hub = await loadHub(db, hubId);
      const existing = (await listDraftRules(db, botId)).map((r) => r.ruleId);
      const isNew = ruleRef === "new";
      if (!isNew && !existing.includes(ruleRef)) return apiError("botBuilder.ruleNotFound", 404, undefined, NO_STORE);
      const checked = checkRule(body, hub, existing);
      if (!checked.ok) return reply({ errors: checked.errors }, 400);
      try {
        const ruleId = await saveRuleDraft(db, botId, isNew ? null : ruleRef, checked.rule, user.id);
        await audit(db, hubId, user.id, "bot.rule.save", botId, bot.name);
        return reply({ ruleId });
      } catch (error) {
        if (error instanceof BotStoreError && error.code === "RULE_LIMIT")
          return apiErrorLegacy(
            error.code,
            "botBuilder.ruleLimit",
            409,
            { max: BOT_LIMITS.rulesPerBot },
            undefined,
            NO_STORE,
          );
        if (error instanceof BotStoreError && error.code === "NOT_FOUND")
          return apiError("botBuilder.ruleNotFound", 404, undefined, NO_STORE);
        throw error;
      }
    }
    if (method === "DELETE") {
      if (!(await deleteRule(db, botId, ruleRef))) return apiError("botBuilder.ruleNotFound", 404, undefined, NO_STORE);
      await audit(db, hubId, user.id, "bot.rule.delete", botId, bot.name);
      return reply({ success: true });
    }
  }
  return null;
}

/**
 * Template and imported bots start able to do what their rules do (a bot made
 * from scratch keeps send_messages; the builder offers to allow more).
 */
async function grantRuleCapabilities(db: D1Database, hubId: number, botId: string, rules: BotRule[]) {
  const needed = capabilitiesForRules(rules);
  if (needed.some((c) => c !== "send_messages"))
    await updateBotSettings(db, hubId, botId, {
      capabilities: normalizeHubBotCapabilities(["send_messages", ...needed], ["send_messages"]),
    });
}

async function importBot(env: ApiContext["env"], hubId: number, userId: string, body: Record<string, unknown>) {
  const db = env.DB;
  const name = cleanText(body.name, 32);
  if (!name) return apiError("common.botNameRequired", 400, undefined, NO_STORE);
  if (!Array.isArray(body.rules) || body.rules.length > BOT_LIMITS.rulesPerBot)
    return apiError("botBuilder.tooManyRules", 400, { max: BOT_LIMITS.rulesPerBot }, NO_STORE);

  const hub = await loadHub(db, hubId);
  const channelByName = new Map<string, string>();
  for (const c of hub.channels) if (!channelByName.has(`#${c.name}`)) channelByName.set(`#${c.name}`, c.id);
  const voiceByName = new Map<string, string>();
  for (const c of hub.voice) if (!voiceByName.has(`~${c.name}`)) voiceByName.set(`~${c.name}`, c.id);
  const roleByName = new Map<string, string>();
  for (const r of hub.roles) if (!roleByName.has(`@${r.name}`)) roleByName.set(`@${r.name}`, r.id);

  const unresolved = new Set<string>();
  const resolve = (byName: Map<string, string>) => (ref: string) => {
    const id = byName.get(ref);
    if (id !== undefined) return id;
    if (ref) unresolved.add(ref);
    return "";
  };
  const placeholders = body.rules.map((_, i) => `rule:${i}`);
  const accepted: BotRule[] = [];
  const errors: (BotRuleError & { ruleIndex: number })[] = [];
  body.rules.forEach((raw, index) => {
    if (!raw || typeof raw !== "object") {
      errors.push({ ruleIndex: index, path: "", message: "Must be an object.", code: "bots.validation.notObject" });
      return;
    }
    const mapped = mapRuleIds(raw as BotRule, {
      channel: resolve(channelByName),
      voice: resolve(voiceByName),
      role: resolve(roleByName),
      rule: (ref) => (placeholders.includes(ref) ? ref : ""),
    });
    const checked = checkRule(mapped, hub, placeholders, true);
    if (checked.ok) accepted.push(checked.rule);
    else errors.push(...checked.errors.map((e) => ({ ruleIndex: index, ...e })));
  });
  if (errors.length) return reply({ errors }, 400);

  let bot: BotRow;
  try {
    bot = await createBuilderBot(db, { hubId, name, description: cleanText(body.description, 180), createdBy: userId });
  } catch (error) {
    if (error instanceof BotStoreError && error.code === "BOT_LIMIT")
      return apiErrorLegacy(
        error.code,
        "botBuilder.botLimit",
        409,
        { max: BOT_LIMITS.botsPerHub },
        undefined,
        NO_STORE,
      );
    throw error;
  }
  const look: { color?: string; avatarEmoji?: string } = {};
  if (typeof body.color === "string" && /^#[0-9a-fA-F]{6}$/.test(body.color)) look.color = body.color;
  if (typeof body.avatarEmoji === "string" && body.avatarEmoji.length <= 16) look.avatarEmoji = body.avatarEmoji;
  if (look.color || look.avatarEmoji) await updateBotSettings(db, hubId, bot.id, look);

  await grantRuleCapabilities(db, hubId, bot.id, accepted);
  const savedIds: string[] = [];
  for (const rule of accepted) savedIds.push(await saveRuleDraft(db, bot.id, null, rule, userId));
  // Rules that call other rules referred to them by position; point them at the new ids.
  for (let i = 0; i < accepted.length; i++) {
    const refs = mapRuleIds(accepted[i], {
      rule: (ref) => {
        const at = placeholders.indexOf(ref);
        return at >= 0 ? savedIds[at] : "";
      },
    });
    if (JSON.stringify(refs) !== JSON.stringify(accepted[i]))
      await saveRuleDraft(db, bot.id, savedIds[i], refs, userId);
  }
  await audit(db, hubId, userId, "bot.import", bot.id, name);
  return reply(
    { bot: await clientBot(db, (await getBot(db, hubId, bot.id)) ?? bot), unresolved: [...unresolved] },
    201,
  );
}

/**
 * Dry-runs one rule's draft against a sample event: returns what each action
 * would do. Nothing is posted, stored, logged or cooled down.
 */
async function testRun(
  env: ApiContext["env"],
  hubId: number,
  bot: BotRow,
  userId: string,
  body: Record<string, unknown>,
) {
  const db = env.DB;
  const ruleId = typeof body.ruleId === "string" ? body.ruleId : "";
  const draft = (await listDraftRules(db, bot.id)).find((r) => r.ruleId === ruleId);
  if (!draft) return apiError("botBuilder.ruleNotFound", 404, undefined, NO_STORE);
  const input = body.event;
  if (!input || typeof input !== "object" || Array.isArray(input))
    return apiError("botBuilder.eventRequired", 400, undefined, NO_STORE);
  const sample = input as Record<string, unknown>;
  const kind = sample.kind;
  if (typeof kind !== "string" || !(TRIGGER_TYPES as string[]).includes(kind))
    return apiError("botBuilder.eventKindInvalid", 400, undefined, NO_STORE);
  const data = sample.data ?? {};
  if (typeof data !== "object" || data === null || Array.isArray(data))
    return apiError("botBuilder.eventDataInvalid", 400, undefined, NO_STORE);
  const actorId = sample.actorId === undefined ? userId : sample.actorId;
  if (actorId !== null && (typeof actorId !== "string" || actorId.length > 64))
    return apiError("botBuilder.eventActorInvalid", 400, undefined, NO_STORE);
  // The sample happens in a room of this Hub: the one asked for, else the first text room.
  const asked = sample.roomId === undefined || sample.roomId === null ? null : Number(sample.roomId);
  const room = await db
    .prepare(
      asked === null
        ? "SELECT id FROM decave_rooms WHERE hub_id=? AND type='text' ORDER BY position,id LIMIT 1"
        : "SELECT id FROM decave_rooms WHERE hub_id=? AND id=?",
    )
    .bind(...(asked === null ? [hubId] : [hubId, asked]))
    .first<{ id: number }>();
  if (asked !== null && !room) return apiError("botBuilder.eventRoomInvalid", 400, undefined, NO_STORE);
  const event: BotEvent = {
    hubId,
    roomId: room ? Number(room.id) : null,
    kind: kind as BotEvent["kind"],
    actorId,
    actorIsBot: false,
    chainDepth: 0,
    // A schedule only fires for its own rule.
    data: kind === "schedule" ? { ...data, ruleId } : (data as Record<string, unknown>),
  };
  const steps = await dispatchBotEvent(env, event, {
    dryRun: true,
    onlyRuleId: ruleId,
    ruleOverride: { botId: bot.id, ruleId, rule: draft.draft, publishedBy: userId },
  });
  return reply({ steps });
}

/** Drafts rules from a description with the AI helper. Returned to the client only; never saved here. */
async function generateForHub(env: ApiContext["env"], hubId: number, body: Record<string, unknown>) {
  const db = env.DB;
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!description || description.length > DESCRIPTION_MAX)
    return apiError("botBuilder.descriptionLength", 400, { max: DESCRIPTION_MAX }, NO_STORE);
  let existing: BotRule | undefined;
  let ruleIds: string[] = [];
  if (body.ruleId !== undefined) {
    if (typeof body.ruleId !== "string") return apiError("botBuilder.ruleIdInvalid", 400, undefined, NO_STORE);
    const row = await db
      .prepare(
        `SELECT r.bot_id,r.draft_json FROM decave_bot_rules r JOIN decave_hub_bots b ON b.id=r.bot_id
         WHERE r.id=? AND b.hub_id=? AND b.kind='builder' AND r.draft_deleted=0`,
      )
      .bind(body.ruleId, hubId)
      .first<{ bot_id: string; draft_json: string }>();
    if (!row) return apiError("botBuilder.ruleNotFound", 404, undefined, NO_STORE);
    existing = JSON.parse(row.draft_json) as BotRule;
    ruleIds = (await listDraftRules(db, row.bot_id)).map((r) => r.ruleId);
  }
  const hub = await loadHub(db, hubId);
  const result = await generateRules(env, {
    hubId,
    description,
    channels: hub.channels,
    voiceRooms: hub.voice,
    roles: hub.roles,
    existing,
    ruleIds,
  });
  if (!result.ok) return apiError(result.code, result.status, result.params, NO_STORE);
  return reply({ rules: result.rules, unsupported: result.unsupported, remainingToday: result.remainingToday });
}
