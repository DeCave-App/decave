// Input validation for usernames, passwords, email addresses and phone numbers.

/** Kept for compatibility with existing callers; phone collection is retired. */
export function cleanPhoneNumber(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return "";
  const normalized = trimmed.replace(/[\s().-]+/g, "");
  return /^\+?[0-9]{7,15}$/.test(normalized) ? normalized : null;
}

export function validateUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const username = value.trim();
  return username.length >= 3 && username.length <= 24 && /^[a-zA-Z0-9_.-]+$/.test(username) ? username : null;
}

export function validatePassword(value: unknown): string | null {
  return typeof value === "string" && value.length >= 10 && value.length <= 128 ? value : null;
}

export function validateEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length < 5 || email.length > 254) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}
