// Health check and voice ICE (TURN) servers.

import { json } from "../lib/http";
import { requireUser } from "../lib/sessions";
import { cloudflareTurnIceServers } from "../lib/turn";
import type { ApiContext } from "./context";

export async function handleHealthRoutes({ p, method }: ApiContext): Promise<Response | null> {
  if (method === "GET" && p === "/api/health") {
    return json({ name: "DeCave", status: "online" }, 200, { "Cache-Control": "no-store" });
  }

  return null;
}

export async function handleRtcRoutes({ request, env, p, method }: ApiContext): Promise<Response | null> {
  if (method === "GET" && p === "/api/rtc/ice-servers") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;

    const stunOnly = [{ urls: ["stun:stun.cloudflare.com:3478"] }];
    const turnIceServers = await cloudflareTurnIceServers(env);
    return json({ iceServers: turnIceServers ?? stunOnly, turnEnabled: turnIceServers !== null });
  }

  return null;
}
