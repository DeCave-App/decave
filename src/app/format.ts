// Small formatting helpers for labels, shortcuts, durations and sizes.

import type { KeyboardEvent } from "react";

export function acceleratorFromKeyEvent(event: KeyboardEvent<HTMLInputElement>): string | null {
  const key = event.key;
  if (["Control", "Shift", "Alt", "Meta"].includes(key)) return null;
  const modifiers: string[] = [];
  if (event.ctrlKey || event.metaKey) modifiers.push("CommandOrControl");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (!modifiers.length) return null;

  let acceleratorKey = "";
  if (/^Key[A-Z]$/.test(event.code)) acceleratorKey = event.code.slice(3);
  else if (/^Digit[0-9]$/.test(event.code)) acceleratorKey = event.code.slice(5);
  else if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(event.code)) acceleratorKey = event.code;
  else {
    acceleratorKey =
      (
        {
          Space: "Space",
          ArrowUp: "Up",
          ArrowDown: "Down",
          ArrowLeft: "Left",
          ArrowRight: "Right",
          Home: "Home",
          End: "End",
          PageUp: "PageUp",
          PageDown: "PageDown",
          Insert: "Insert",
          Delete: "Delete",
        } as Record<string, string>
      )[event.code] || "";
  }
  return acceleratorKey ? [...modifiers, acceleratorKey].join("+") : null;
}

export function friendlyAccelerator(accelerator: string): string {
  return accelerator
    .replace(/CommandOrControl/gi, navigator.platform.toLowerCase().includes("mac") ? "Cmd" : "Ctrl")
    .replace(/Command/gi, "Cmd")
    .replace(/Control/gi, "Ctrl")
    .replace(/\+/g, " + ");
}

export function readableAuditLabel(value: string): string {
  return value
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\bMfa\b/g, "MFA")
    .replace(/\bDm\b/g, "DM")
    .replace(/\bApi\b/g, "API");
}

export function readableDevice(userAgent: string): string {
  if (!userAgent) return "Device details unavailable";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Chrome\//.test(userAgent)
      ? "Chrome"
      : /Firefox\//.test(userAgent)
        ? "Firefox"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : /Electron\//.test(userAgent)
            ? "DeCave Desktop"
            : "Unknown client";
  const system = /Windows NT/.test(userAgent)
    ? "Windows"
    : /Mac OS X/.test(userAgent)
      ? "macOS"
      : /Android/.test(userAgent)
        ? "Android"
        : /iPhone|iPad/.test(userAgent)
          ? "iOS"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "Unknown OS";
  return `${browser} on ${system}`;
}

export function securityEventSeverity(value: string): "high" | "medium" | "info" {
  const normalized = value.toLowerCase();
  if (/suspend|erase|delete|breach|failed|revoke|reset/.test(normalized)) return "high";
  if (/login|password|mfa|device|session|role|permission/.test(normalized)) return "medium";
  return "info";
}

export function formatActivityElapsed(startedAt: string | null | undefined, now = Date.now()): string {
  if (!startedAt) return "";
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started) || started > now) return "";
  const totalSeconds = Math.floor((now - started) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const seconds = totalSeconds % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

export function formatUpdateBytes(value: number | null): string {
  if (!Number.isFinite(value) || value === null || value < 0) return "";
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${Math.round(value)} B`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function formatRtcBitrate(bitrateKbps: number | null | undefined): string {
  if (bitrateKbps === null || bitrateKbps === undefined || !Number.isFinite(bitrateKbps)) return "Connecting…";
  if (bitrateKbps >= 1000) return `${(bitrateKbps / 1000).toFixed(1)} Mbps`;
  return `${Math.max(0, Math.round(bitrateKbps))} kbps`;
}
