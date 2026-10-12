// Flow actions: stop the rule, or run another rule of the same bot.

import { guardPublisher, refused } from "./guard";
import { getRuleRunner, registerAction } from "./registry";

registerAction("stop", {
  capability: null,
  run: async () => ({ stop: true }),
});

registerAction("runRule", {
  capability: null,
  async run(ctx, action) {
    if (action.type !== "runRule") return { ok: true };
    const publisher = await guardPublisher(ctx);
    if (refused(publisher)) return { ok: false, reason: publisher.reason };
    const runner = getRuleRunner();
    if (!runner) return { ok: false, reason: "Rules can't be run here" };
    return runner(ctx, action.ruleId);
  },
});
