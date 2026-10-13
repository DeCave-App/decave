// In-app feedback and bug reports.

import { requireUser } from "../lib/sessions";
import { boundedBodyJson, json, requestKey } from "../lib/http";
import { nowIso, publicIdOf } from "../db";
import type { ApiContext } from "./context";

const FEEDBACK_BODY_LIMIT = 32 * 1024;

export async function handleFeedbackRoutes({ request, env, p, method }: ApiContext): Promise<Response | null> {
  if (method === "POST" && p === "/api/feedback") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;

    const [accountLimit, ipLimit] = await Promise.all([
      env.AUTH_RATE_LIMITER.limit({ key: `feedback-account:${user.id}` }),
      env.AUTH_RATE_LIMITER.limit({ key: requestKey(request, "feedback") }),
    ]);
    if (!accountLimit.success || !ipLimit.success) {
      return json({ error: "Too many feedback submissions. Try again shortly." }, 429);
    }

    const body = await boundedBodyJson(request, FEEDBACK_BODY_LIMIT);
    if (!body) return json({ error: "Feedback request is too large." }, 413);

    const type = body.type === undefined ? "bug" : body.type;
    if (type !== "bug" && type !== "feature") return json({ error: "Feedback type must be bug or feature." }, 400);
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (message.length > 4000) return json({ error: "Feedback message must be 4000 characters or fewer." }, 400);
    const contact = typeof body.contact === "string" ? body.contact.trim() : "";
    if (body.contact !== undefined && typeof body.contact !== "string") {
      return json({ error: "Contact email must be text." }, 400);
    }
    if (contact.length > 254) return json({ error: "Contact email must be 254 characters or fewer." }, 400);

    if (!message) return json({ error: "Feedback cannot be empty." }, 400);

    const id = crypto.randomUUID();
    const createdAt = nowIso();

    await env.DB.prepare(
      `INSERT INTO decave_feedback
         (id,user_id,username,contact_email,type,message,status,created_at)
         VALUES(?,?,?,?,?,?, 'open', ?)`,
    )
      .bind(id, user.id, user.username, contact, type, message, createdAt)
      .run();

    if (env.FEEDBACK_TO_EMAIL && env.EMAIL) {
      try {
        await env.EMAIL.send({
          to: env.FEEDBACK_TO_EMAIL,
          from: { email: "security@de-cave.com", name: "DeCave Feedback" },
          subject: `[DeCave ${type === "bug" ? "Bug" : "Feature"}] ${user.username}`,
          text:
            `Type: ${type}\n` +
            `User: ${user.username}\n` +
            `DeCave ID: ${publicIdOf(user)}\n` +
            `Reply email: ${contact || "(not shared)"}\n\n` +
            message,
        });
      } catch (error) {
        console.warn("Could not email feedback notification:", error instanceof Error ? error.name : "UnknownError");
      }
    }

    return json({ success: true, id });
  }

  return null;
}
