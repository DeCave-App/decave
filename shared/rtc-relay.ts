/** Only authenticated TURN servers are safe for relay-only peer connections. */
export function hasUsableRelayIceServers(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.some((candidate) => {
    if (!candidate || typeof candidate !== "object") return false;
    const server = candidate as { urls?: unknown; username?: unknown; credential?: unknown };
    const urls = typeof server.urls === "string" ? [server.urls] : server.urls;
    return (
      Array.isArray(urls) &&
      urls.some((url) => typeof url === "string" && /^turns?:/i.test(url)) &&
      typeof server.username === "string" &&
      server.username.length > 0 &&
      typeof server.credential === "string" &&
      server.credential.length > 0
    );
  });
}
