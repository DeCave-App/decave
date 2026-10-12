// Input validation for usernames, passwords and email addresses.

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
