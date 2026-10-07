import productionHandler from "./index";
import type { Env } from "./index";
import { hasValidStagingAccess, stagingAccessDeniedResponse } from "./staging-access";

export { HubRoom } from "./index";

type StagingEnv = Env & { STAGING_ACCESS_TOKEN?: string };

/**
 * Staging-only outer gate. Production keeps worker/index.ts as its entrypoint.
 * Every request, including health, assets, WebSocket upgrades, and OPTIONS,
 * must carry the high-entropy secret header before reaching the application.
 */
export default {
  async fetch(request: Request, env: StagingEnv): Promise<Response> {
    if (!hasValidStagingAccess(request, env)) return stagingAccessDeniedResponse();
    return productionHandler.fetch(request, env);
  },
};
