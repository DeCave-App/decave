export type DiscordImportRoom = {
  name: string;
  type: "text" | "voice" | "forum";
  category: string;
  icon: string;
  private: boolean;
  sourceType: number;
};

export type DiscordImportRole = {
  name: string;
  color: string;
};

export type DiscordImportPreview = {
  code: string;
  name: string;
  description: string;
  categories: number;
  rooms: DiscordImportRoom[];
  roles: DiscordImportRole[];
  unsupported: string[];
};

export type DiscordImportExistingRoom = {
  id: string | number;
  name: string;
  type: "text" | "voice" | "forum" | string;
  category?: string;
};

export type DiscordImportExistingRole = {
  id: string;
  name: string;
  color?: string;
};

export type DiscordImportConflict = {
  kind: "room" | "role";
  name: string;
  category?: string;
  existingId: string | number;
  resolution: "skip";
};

export type DiscordImportDryRun = {
  sourceName: string;
  sourceCode?: string;
  fingerprint: string;
  create: { rooms: DiscordImportRoom[]; roles: DiscordImportRole[] };
  conflicts: DiscordImportConflict[];
  unsupported: string[];
  summary: { rooms: number; roles: number; conflicts: number; unsupported: number };
};

export function extractDiscordTemplateCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();
    const parts = url.pathname.split("/").filter(Boolean);
    const code =
      host === "discord.new"
        ? parts.length === 1
          ? parts[0]
          : ""
        : (host === "discord.com" || host === "discordapp.com") && parts[0] === "template" && parts.length === 2
          ? parts[1]
          : "";
    return /^[a-zA-Z0-9_-]{2,100}$/.test(code) ? code : null;
  } catch {
    return null;
  }
}

function cleanName(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value.trim().replace(/\s+/g, " ").slice(0, 40);
  return cleaned || fallback;
}

function colorToHex(value: unknown): string {
  const number =
    typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(0xffffff, Math.floor(value))) : 0x62d6ff;
  return `#${number.toString(16).padStart(6, "0")}`;
}

export function normalizeDiscordTemplatePayload(payload: unknown, code: string): DiscordImportPreview {
  const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const guild =
    root.serialized_source_guild && typeof root.serialized_source_guild === "object"
      ? (root.serialized_source_guild as Record<string, unknown>)
      : root;
  const rawChannels = Array.isArray(guild.channels) ? guild.channels : [];
  const categories = rawChannels.filter(
    (channel) => channel && typeof channel === "object" && (channel as Record<string, unknown>).type === 4,
  );
  const categoryNames = new Map<string, string>();
  for (const category of categories) {
    const item = category as Record<string, unknown>;
    if (typeof item.id === "string") categoryNames.set(item.id, cleanName(item.name, "CATEGORY"));
  }

  const rooms: DiscordImportRoom[] = [];
  const unsupported = new Set<string>();
  const seenRooms = new Set<string>();
  for (const channel of rawChannels) {
    if (!channel || typeof channel !== "object") continue;
    const item = channel as Record<string, unknown>;
    const sourceType = typeof item.type === "number" ? item.type : -1;
    if (sourceType === 4) continue;
    const mappedType = sourceType === 2 ? "voice" : sourceType === 15 ? "forum" : sourceType === 0 ? "text" : null;
    const name = cleanName(item.name, "room");
    if (!mappedType) {
      unsupported.add(`${name} (Discord channel type ${sourceType})`);
      continue;
    }
    const category = typeof item.parent_id === "string" ? (categoryNames.get(item.parent_id) ?? "GENERAL") : "GENERAL";
    const key = `${mappedType}:${category}:${name.toLowerCase()}`;
    if (seenRooms.has(key)) continue;
    seenRooms.add(key);
    rooms.push({
      name,
      type: mappedType,
      category,
      icon: mappedType === "voice" ? "🔊" : mappedType === "forum" ? "▤" : "💬",
      private: false,
      sourceType,
    });
  }

  const roles: DiscordImportRole[] = [];
  const seenRoles = new Set<string>();
  const rawRoles = Array.isArray(guild.roles) ? guild.roles : [];
  for (const role of rawRoles) {
    if (!role || typeof role !== "object") continue;
    const item = role as Record<string, unknown>;
    const name = cleanName(item.name, "Role");
    if (name === "@everyone" || seenRoles.has(name.toLowerCase())) continue;
    seenRoles.add(name.toLowerCase());
    roles.push({ name: name.slice(0, 32), color: colorToHex(item.color) });
    if (roles.length >= 24) break;
  }

  return {
    code,
    name: cleanName(root.name ?? guild.name, "Imported Discord Hub"),
    description: cleanName(root.description, "Imported from a Discord Server Template"),
    categories: categories.length,
    rooms: rooms.slice(0, 60),
    roles,
    unsupported: [...unsupported].slice(0, 20),
  };
}

export function sanitizeDiscordImport(
  value: unknown,
): Pick<DiscordImportPreview, "rooms" | "roles" | "unsupported"> | null {
  if (!value || typeof value !== "object") return null;
  const root = value as Record<string, unknown>;
  const rooms: DiscordImportRoom[] = [];
  const seenRooms = new Set<string>();
  if (Array.isArray(root.rooms)) {
    for (const candidate of root.rooms.slice(0, 60)) {
      if (!candidate || typeof candidate !== "object") continue;
      const item = candidate as Record<string, unknown>;
      const type = item.type === "voice" || item.type === "forum" || item.type === "text" ? item.type : null;
      if (!type) continue;
      const name = cleanName(item.name, "room");
      const category = cleanName(item.category, "GENERAL");
      const key = `${type}:${category}:${name.toLowerCase()}`;
      if (seenRooms.has(key)) continue;
      seenRooms.add(key);
      rooms.push({
        name,
        type,
        category,
        icon:
          typeof item.icon === "string" && item.icon.trim()
            ? Array.from(item.icon.trim()).slice(0, 4).join("")
            : type === "voice"
              ? "🔊"
              : type === "forum"
                ? "▤"
                : "💬",
        private: false,
        sourceType:
          typeof item.sourceType === "number" ? item.sourceType : type === "voice" ? 2 : type === "forum" ? 15 : 0,
      });
    }
  }
  const roles: DiscordImportRole[] = [];
  const seenRoles = new Set<string>();
  if (Array.isArray(root.roles)) {
    for (const candidate of root.roles.slice(0, 24)) {
      if (!candidate || typeof candidate !== "object") continue;
      const item = candidate as Record<string, unknown>;
      const name = cleanName(item.name, "Role").slice(0, 32);
      if (name === "@everyone" || seenRoles.has(name.toLowerCase())) continue;
      const color = typeof item.color === "string" && /^#[0-9a-fA-F]{6}$/.test(item.color) ? item.color : "#62d6ff";
      seenRoles.add(name.toLowerCase());
      roles.push({ name, color });
    }
  }
  const unsupported = Array.isArray(root.unsupported)
    ? root.unsupported.filter((item): item is string => typeof item === "string").slice(0, 20)
    : [];
  return { rooms, roles, unsupported };
}

/**
 * Build a deterministic review object before any database writes. Matching is
 * intentionally conservative: a room conflicts only when its type, category,
 * and normalized name all match; roles conflict by normalized name. Existing
 * records are always retained and therefore resolve to `skip`.
 */
export function buildDiscordImportDryRun(
  preview: Pick<DiscordImportPreview, "name" | "code" | "rooms" | "roles" | "unsupported">,
  existingRooms: readonly DiscordImportExistingRoom[] = [],
  existingRoles: readonly DiscordImportExistingRole[] = [],
): DiscordImportDryRun {
  const imported = sanitizeDiscordImport(preview) ?? { rooms: [], roles: [], unsupported: [] };
  const roomKey = (room: { name: string; type: string; category: string }) =>
    `${room.type}:${room.category.trim().toLocaleLowerCase()}:${room.name.trim().toLocaleLowerCase()}`;
  const existingRoomKeys = new Map(
    existingRooms.map((room) => [
      roomKey({ name: room.name, type: room.type, category: room.category ?? "GENERAL" }),
      room,
    ]),
  );
  const existingRoleNames = new Map(existingRoles.map((role) => [role.name.trim().toLocaleLowerCase(), role]));
  const conflicts: DiscordImportConflict[] = [];
  const rooms: DiscordImportRoom[] = [];
  const roles: DiscordImportRole[] = [];
  for (const room of imported.rooms) {
    const existing = existingRoomKeys.get(roomKey(room));
    if (existing)
      conflicts.push({
        kind: "room",
        name: room.name,
        category: room.category,
        existingId: existing.id,
        resolution: "skip",
      });
    else rooms.push(room);
  }
  for (const role of imported.roles) {
    const existing = existingRoleNames.get(role.name.trim().toLocaleLowerCase());
    if (existing) conflicts.push({ kind: "role", name: role.name, existingId: existing.id, resolution: "skip" });
    else roles.push(role);
  }
  const fingerprint = JSON.stringify({
    sourceCode: typeof preview.code === "string" ? preview.code : "",
    sourceName: typeof preview.name === "string" ? preview.name.trim().slice(0, 40) : "Imported Discord Hub",
    rooms,
    roles,
    conflicts: conflicts.map(({ kind, name, category, existingId }) => ({
      kind,
      name,
      category: category ?? "",
      existingId,
    })),
    unsupported: imported.unsupported,
  });
  return {
    sourceName:
      typeof preview.name === "string"
        ? preview.name.trim().slice(0, 40) || "Imported Discord Hub"
        : "Imported Discord Hub",
    sourceCode: typeof preview.code === "string" ? preview.code : undefined,
    fingerprint,
    create: { rooms, roles },
    conflicts,
    unsupported: imported.unsupported,
    summary: {
      rooms: rooms.length,
      roles: roles.length,
      conflicts: conflicts.length,
      unsupported: imported.unsupported.length,
    },
  };
}

export type DiscordImportApplyResult = {
  importId: string;
  createdRoomIds: number[];
  createdRooms: Array<{ id: number; name: string; type: string; category: string }>;
  createdRoleIds: string[];
  createdRoles: Array<{ id: string; name: string; color: string }>;
  retainedConflictCount: number;
  rollback: "available";
};

export type DiscordImportRollbackResult = {
  importId: string;
  deletedRoomIds: number[];
  retainedRoomIds: number[];
  deletedRoleIds: string[];
  retainedRoleIds: string[];
  message: string;
};
