// Account emails: verification, password reset, sign-in alerts and email-change notices.

import type { Env } from "./env";
import { escapeHtml } from "./http";

export async function sendVerificationEmail(
  env: Env,
  email: string,
  username: string,
  token: string,
  baseUrl: string,
): Promise<void> {
  // Keep the one-time credential out of the request URL: mail scanners can
  // fetch the page without sending the fragment to the Worker.
  const link = `${baseUrl}/#token=${encodeURIComponent(token)}`;
  await env.EMAIL.send({
    to: email,
    from: { email: "security@example.invalid", name: "DeCave Security" },
    subject: "Verify your DeCave email",
    text: `Hi ${username}, verify your DeCave email: ${link}`,
    html: `<div style="font-family:Arial,sans-serif;background:#080d18;color:#eef4ff;padding:28px"><h2>Verify your DeCave email</h2><p>Hi ${escapeHtml(username)},</p><p>Confirm this email address to activate your account.</p><p><a href="${link}" style="display:inline-block;padding:12px 18px;background:#5fe1ff;color:#06111b;border-radius:10px;text-decoration:none;font-weight:700">Verify email</a></p><p>This link expires in 24 hours.</p></div>`,
  });
}

export async function sendResetEmail(
  env: Env,
  email: string,
  username: string,
  token: string,
  baseUrl: string,
): Promise<void> {
  const link = `${baseUrl}/api/auth/reset?token=${encodeURIComponent(token)}`;
  await env.EMAIL.send({
    to: email,
    from: { email: "security@example.invalid", name: "DeCave Security" },
    subject: "Reset your DeCave password",
    text: `Hi ${username}, reset your DeCave password: ${link}`,
    html: `<div style="font-family:Arial,sans-serif;background:#080d18;color:#eef4ff;padding:28px"><h2>Reset your DeCave password</h2><p>Hi ${escapeHtml(username)},</p><p>If you requested a password reset, use the button below.</p><p><a href="${link}" style="display:inline-block;padding:12px 18px;background:#8c6cff;color:white;border-radius:10px;text-decoration:none;font-weight:700">Reset password</a></p><p>This link expires in 30 minutes.</p></div>`,
  });
}

export async function sendSignInAlertEmail(
  env: Env,
  email: string,
  username: string,
  device: string,
  at: string,
  token: string,
  baseUrl: string,
): Promise<void> {
  // Tokens in fragments are not sent in HTTP requests or referrer headers.
  const link = `${baseUrl}/api/auth/secure-account#token=${encodeURIComponent(token)}`;
  const when = new Date(at).toUTCString();
  await env.EMAIL.send({
    to: email,
    from: { email: "security@example.invalid", name: "DeCave Security" },
    subject: "New sign-in to your DeCave account",
    text: `Hi ${username},\n\nYour DeCave account was just used to sign in on: ${device}\nTime: ${when}\n\nIf this was you, you don't need to do anything.\n\nIf it wasn't you, secure your account now (signs out every device and sends a password reset link): ${link}\n\nYou can turn these emails off in Settings > Account & security.`,
    html: `<div style="font-family:Arial,sans-serif;background:#080d18;color:#eef4ff;padding:28px"><h2 style="margin-top:0">New sign-in to DeCave</h2><p>Hi ${escapeHtml(username)},</p><p>Your account was just used to sign in on:</p><p style="padding:12px 14px;border-radius:10px;background:#10182a;border:1px solid #273653"><strong>${escapeHtml(device)}</strong><br><span style="color:#9fb0c8">${escapeHtml(when)}</span></p><p>If this was you, you don't need to do anything.</p><p><a href="${link}" style="display:inline-block;padding:12px 18px;background:#ff6b7d;color:#14060a;border-radius:10px;text-decoration:none;font-weight:700">This wasn't me</a></p><p style="color:#9fb0c8;font-size:13px">That signs out every device and emails you a password reset link. The link works for 7 days. Turn these emails off in Settings &gt; Account &amp; security.</p></div>`,
  });
}

export async function sendEmailChangeNotice(
  env: Env,
  oldEmail: string,
  username: string,
  newEmail: string,
): Promise<void> {
  await env.EMAIL.send({
    to: oldEmail,
    from: { email: "security@example.invalid", name: "DeCave Security" },
    subject: "Your DeCave email address was changed",
    text: `Hi ${username},

The email address on your DeCave account was changed to ${newEmail}. If you did not make this change, sign in to DeCave, change your password and sign out other devices in Settings > Account & security.`,
    html: `<div style="font-family:Arial,sans-serif;background:#080d18;color:#eef4ff;padding:28px"><h2 style="margin-top:0">Your DeCave email address changed</h2><p>Hi ${escapeHtml(username)},</p><p>The email address on your account was changed to <strong>${escapeHtml(newEmail)}</strong>.</p><p>If you did not make this change, sign in to DeCave, change your password and sign out other devices in Settings &gt; Account &amp; security.</p></div>`,
  });
}
