// Platform owners: roles, owner lookups and the platform audit log.

import type { Env } from "./env";
import { type UserRow, nowIso } from "../db";
import { requireUser } from "./sessions";
import { json } from "./http";

export type PlatformRole = "user" | "admin" | "owner";

export type PlatformOwnerListRow = {
  id: string;
  public_id: string | null;
  username: string;
  email: string | null;
  email_verified_at: string | null;
  platform_role: PlatformRole;
  created_at: string;
};

export async function requirePlatformOwner(request: Request, env: Env): Promise<UserRow | Response> {
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;

  // Authorization is always resolved from the current D1 user row.
  // Nothing sent by the browser can grant platform privileges.
  if (user.platform_role !== "owner") {
    return json({ error: "Platform owner access required" }, 403);
  }

  return user;
}

export async function platformOwnerCount(db: D1Database): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS count FROM decave_users WHERE platform_role='owner'")
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}

export async function platformAudit(
  env: Env,
  actorUserId: string,
  action: string,
  request: Request,
  targetUserId: string | null = null,
  detail: Record<string, string | number | boolean | null> = {},
): Promise<void> {
  // Keep the platform audit log intentionally minimal:
  // no passwords, session tokens, reset tokens, message contents or raw IP.
  const detailJson = JSON.stringify(detail).slice(0, 1600);
  const ray = (request.headers.get("CF-Ray") ?? "").slice(0, 80);

  await env.DB.prepare(
    `INSERT INTO decave_platform_audit
     (id, actor_user_id, target_user_id, action, detail_json, request_ray, request_country, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), actorUserId, targetUserId, action, detailJson, ray || null, null, nowIso())
    .run();
}

export async function platformUserByIdentifier(db: D1Database, identifier: string): Promise<UserRow | null> {
  const clean = identifier.trim();
  if (!clean || clean.length > 254) return null;
  const normalized = clean.toLowerCase();

  return (
    (await db
      .prepare(
        `SELECT *
         FROM decave_users
         WHERE public_id = ? COLLATE NOCASE
            OR username = ? COLLATE NOCASE
            OR email_normalized = ?
         LIMIT 1`,
      )
      .bind(clean, clean, normalized)
      .first<UserRow>()) ?? null
  );
}

export function platformOwnerForClient(row: PlatformOwnerListRow) {
  return {
    id: row.public_id ?? "",
    username: row.username,
    email: row.email,
    emailVerified: Boolean(row.email_verified_at),
    platformRole: row.platform_role,
    createdAt: row.created_at,
  };
}
