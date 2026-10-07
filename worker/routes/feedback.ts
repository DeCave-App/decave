// In-app feedback and bug reports.

import { requireUser } from "../lib/sessions";
import { bodyJson, json } from "../lib/http";
import { nowIso, publicIdOf } from "../db";
import type { ApiContext } from "./context";

export async function handleFeedbackRoutes({ request, env, p, method }: ApiContext): Promise<Response | null> {
  if (method === "POST" && p === "/api/feedback") {
    const user = await requireUser(request, env);
    if (user instanceof Response) return user;

    const body = await bodyJson(request);
    const type = body.type === "feature" ? "feature" : "bug";
    const message = typeof body.message === "string" ? body.message.trim().slice(0, 4000) : "";
    const contact = typeof body.contact === "string" ? body.contact.trim().slice(0, 254) : "";

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
          from: { email: "security@example.invalid", name: "DeCave Feedback" },
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
