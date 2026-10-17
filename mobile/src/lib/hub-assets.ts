/** A Hub's custom emote or sticker (GET /api/servers/:id/assets). */
export type HubAsset = {
  id: string;
  kind: "emote" | "sticker";
  name: string;
  mimeType: string;
  url: string;
  createdAt?: string;
};

/** Stickers travel as prefixed JSON in the message text, like web (src/app/message-payloads.ts). */
export const STICKER_PREFIX = "__DECAVE_STICKER__";

export function stickerMessageText(asset: HubAsset): string {
  return `${STICKER_PREFIX}${JSON.stringify(asset)}`;
}

export function parseSticker(text: string): HubAsset | null {
  if (!text.startsWith(STICKER_PREFIX)) return null;
  try {
    const raw = JSON.parse(text.slice(STICKER_PREFIX.length)) as Partial<HubAsset>;
    if (typeof raw.url !== "string" || !raw.url) return null;
    return {
      id: typeof raw.id === "string" ? raw.id : "",
      kind: "sticker",
      name: typeof raw.name === "string" ? raw.name : "",
      mimeType: typeof raw.mimeType === "string" ? raw.mimeType : "",
      url: raw.url,
    };
  } catch {
    return null;
  }
}

/** Finds the Hub emote a `:name:` token refers to (case-insensitive, like web). */
export function findEmote(assets: readonly HubAsset[], token: string): HubAsset | null {
  if (token.length < 3 || !token.startsWith(":") || !token.endsWith(":")) return null;
  const name = token.slice(1, -1).toLowerCase();
  return assets.find((asset) => asset.kind === "emote" && asset.name.toLowerCase() === name) ?? null;
}
