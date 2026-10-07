// Hub sidebar "category boxes": pure grouping and density rules.
// Every room is always shown. Boxes never collapse; when space runs out the
// tiles get denser instead: roomy tiles (two across, wider for long names),
// compact tiles sized to their names (three or more across when names are
// short), chips, then tight chips for short screens. Names are never cut to
// fit a column; only when even tight chips do not fit does the list scroll.

export type BoxRoom = {
  id: number;
  name: string;
  type: string;
  category?: string;
  private?: boolean;
  icon?: string;
};

export type RoomBoxKind = "category" | "forum" | "voice";

export type RoomBox<R extends BoxRoom = BoxRoom> = {
  /** Stable key, also used for drag-and-drop scoping. */
  key: string;
  kind: RoomBoxKind;
  title: string;
  rooms: R[];
};

export type RoomDensity = "roomy" | "compact" | "chips" | "tight";

export const ROOM_DENSITIES: readonly RoomDensity[] = ["roomy", "compact", "chips", "tight"];

const FALLBACK_TITLE = "Rooms";

/**
 * Turn a stored category into a box title. Templates and Discord imports
 * store categories in capitals ("START HERE"); those read better in sentence
 * case. Mixed-case names the owner typed are kept as written.
 */
export function categoryTitle(raw: string | undefined | null): string {
  const value = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!value) return FALLBACK_TITLE;
  if (value !== value.toUpperCase() || value === value.toLowerCase()) return value;
  const lower = value.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function categoryKey(raw: string | undefined | null): string {
  return (raw ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Group rooms into boxes, keeping the server's room order.
 * - Chat rooms go into one box per category, in order of first appearance.
 * - All forums share one Forums box; all voice rooms share one Voice box.
 * - Owner-only-posting (official) Hubs hide voice, matching the old list.
 */
export function buildRoomBoxes<R extends BoxRoom>(
  rooms: readonly R[],
  options: { ownerOnlyPosting?: boolean } = {},
): RoomBox<R>[] {
  const categories = new Map<string, RoomBox<R>>();
  const forums: R[] = [];
  const voice: R[] = [];
  for (const room of rooms) {
    if (room.type === "forum") {
      forums.push(room);
      continue;
    }
    if (room.type === "voice") {
      voice.push(room);
      continue;
    }
    const key = categoryKey(room.category);
    let box = categories.get(key);
    if (!box) {
      box = { key: `category:${key}`, kind: "category", title: categoryTitle(room.category), rooms: [] };
      categories.set(key, box);
    }
    box.rooms.push(room);
  }
  const boxes: RoomBox<R>[] = [...categories.values()];
  if (forums.length) boxes.push({ key: "forum", kind: "forum", title: "Forums", rooms: forums });
  if (voice.length && !options.ownerOnlyPosting)
    boxes.push({ key: "voice", kind: "voice", title: "Voice", rooms: voice });
  return boxes;
}

export function boxKeyForRoom(boxes: readonly RoomBox[], roomId: number): string | null {
  return boxes.find((box) => box.rooms.some((room) => room.id === roomId))?.key ?? null;
}

/** The room before (-1) or after (+1) this one inside the same box, for Alt+Arrow reordering. */
export function neighbourInBox(boxes: readonly RoomBox[], roomId: number, delta: -1 | 1): number | null {
  const box = boxes.find((item) => item.rooms.some((room) => room.id === roomId));
  if (!box) return null;
  const index = box.rooms.findIndex((room) => room.id === roomId);
  return box.rooms[index + delta]?.id ?? null;
}

// Pixel metrics, kept in sync with hubBoxes.css.
export const BOX_METRICS = {
  /** Title row + padding + border of a box. */
  // At the tight density the title sits inline with the chips (no title row).
  boxChrome: { roomy: 38, compact: 38, chips: 38, tight: 8 },
  boxGap: { roomy: 8, compact: 8, chips: 8, tight: 6 },
  boxInset: 16, // box padding + border, left and right
  rootInset: 16, // room area padding, left and right
  tileGap: 4,
  rowHeight: { roomy: 32, compact: 28, chips: 26, tight: 22 },
  forumTile: { roomy: 50, compact: 44, chips: 26, tight: 22 },
  liveVoiceTile: { roomy: 46, compact: 42, chips: 34, tight: 30 },
  /** Average glyph width of a room name at each density's font size. */
  charWidth: { roomy: 7.1, compact: 6.7, chips: 6.7, tight: 6.3 },
  /** Icon, padding, border and room for a badge, around the name. */
  tileChrome: { roomy: 48, compact: 42, chips: 46, tight: 40 },
  homeLink: { roomy: 38, compact: 38, chips: 38, tight: 32 }, // Hub Home tile
  rootPadding: 20, // room area padding (top 8 + bottom 12)
  defaultWidth: 280, // sidebar width before it has been measured
} as const;

/** Width of an inline box title ("Start here 4 +") at the tight density. */
export function inlineTitleWidth(title: string): number {
  return Math.ceil(44 + Array.from(title).length * 6.2);
}

/** Estimated width of a room tile; long names make wider tiles instead of being cut. */
export function tileWidth(name: string, density: RoomDensity): number {
  return Math.ceil(BOX_METRICS.tileChrome[density] + Array.from(name).length * BOX_METRICS.charWidth[density]);
}

/** Rows needed to wrap tiles of these widths into a line of `available` pixels. */
export function packRows(widths: readonly number[], available: number, gap: number = BOX_METRICS.tileGap): number {
  let rows = 0;
  let x = 0;
  for (const raw of widths) {
    const w = Math.min(raw, available);
    if (rows === 0 || x + gap + w > available) {
      rows += 1;
      x = w;
    } else {
      x += gap + w;
    }
  }
  return rows;
}

/**
 * Estimated height of the room area at a given density and sidebar width.
 * `liveVoiceRoomIds` are voice rooms with people in them, which always get a
 * wide tile. At the roomy density a tile is at least half the box width.
 */
export function estimateBoxesHeight(
  boxes: readonly RoomBox[],
  density: RoomDensity,
  liveVoiceRoomIds: ReadonlySet<number> = new Set(),
  width: number = BOX_METRICS.defaultWidth,
): number {
  const m = BOX_METRICS;
  const inner = Math.max(80, (width > 0 ? width : m.defaultWidth) - m.rootInset - m.boxInset);
  const half = (inner - m.tileGap) / 2;
  const rowsHeight = (rows: number, rowHeight: number) => rows * rowHeight + Math.max(0, rows - 1) * m.tileGap;
  let height = m.homeLink[density] + m.rootPadding;
  for (const box of boxes) {
    height += m.boxChrome[density] + m.boxGap[density];
    if (box.kind === "forum" && density !== "chips" && density !== "tight") {
      height += rowsHeight(box.rooms.length, m.forumTile[density]);
      continue;
    }
    let plain = box.rooms;
    if (box.kind === "voice") {
      const live = box.rooms.filter((room) => liveVoiceRoomIds.has(room.id)).length;
      height += live * (m.liveVoiceTile[density] + m.tileGap);
      plain = box.rooms.filter((room) => !liveVoiceRoomIds.has(room.id));
    }
    const widths = plain.map((room) => {
      const w = tileWidth(room.name, density);
      return density === "roomy" ? Math.max(w, half) : w;
    });
    if (density === "tight") {
      // Title chip first, then the tiles, all wrapping together.
      height += rowsHeight(packRows([inlineTitleWidth(box.title), ...widths], inner), m.rowHeight.tight);
      continue;
    }
    if (!plain.length) continue;
    height += rowsHeight(packRows(widths, inner), m.rowHeight[density]);
  }
  return height;
}

/** The roomiest density whose estimate fits; chips when nothing fits (the list then scrolls). */
export function pickDensity(
  boxes: readonly RoomBox[],
  availableHeight: number,
  liveVoiceRoomIds: ReadonlySet<number> = new Set(),
  width: number = BOX_METRICS.defaultWidth,
): RoomDensity {
  if (!Number.isFinite(availableHeight) || availableHeight <= 0) return "roomy";
  for (const density of ROOM_DENSITIES) {
    if (estimateBoxesHeight(boxes, density, liveVoiceRoomIds, width) <= availableHeight) return density;
  }
  return "chips";
}

/** One step denser, used when the real layout still overflows after the estimate. */
export function denser(density: RoomDensity): RoomDensity {
  const index = ROOM_DENSITIES.indexOf(density);
  return ROOM_DENSITIES[Math.min(ROOM_DENSITIES.length - 1, index + 1)];
}
