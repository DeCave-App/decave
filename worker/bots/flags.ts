// Feature switch for the no-code bot builder. Token bots are not affected.

export function botsEnabled(env: { BOTS_BUILDER_ENABLED?: string }): boolean {
  return env.BOTS_BUILDER_ENABLED === "true";
}
