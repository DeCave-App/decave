import { useEffect, useState } from "react";
import { apiJson } from "@/src/lib/api";
import type { HubAsset } from "@/src/lib/hub-assets";

const cache = new Map<string, HubAsset[]>();
const inflight = new Map<string, Promise<HubAsset[]>>();

function loadHubAssets(hubId: number, token: string): Promise<HubAsset[]> {
  const key = `${token}:${hubId}`;
  const pending = inflight.get(key);
  if (pending) return pending;
  const request = apiJson<HubAsset[]>(`/api/servers/${hubId}/assets`, {}, token)
    .then((value) => {
      const assets = Array.isArray(value) ? value.filter((asset) => asset && typeof asset.url === "string") : [];
      cache.set(key, assets);
      return assets;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, request);
  return request;
}

/** The Hub's emotes and stickers; cached per session and Hub, refreshed when a room opens. */
export function useHubAssets(hubId: number, token: string | null | undefined): HubAsset[] {
  const key = token && hubId > 0 ? `${token}:${hubId}` : "";
  const [assets, setAssets] = useState<HubAsset[]>(() => (key ? (cache.get(key) ?? []) : []));
  useEffect(() => {
    if (!key || !token) {
      setAssets([]);
      return;
    }
    setAssets(cache.get(key) ?? []);
    let cancelled = false;
    loadHubAssets(hubId, token)
      .then((value) => {
        if (!cancelled) setAssets(value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [key, hubId, token]);
  return assets;
}
