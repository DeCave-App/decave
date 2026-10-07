// Node test loader for the small Cloudflare Durable Object shim used by the
// executable worker tests. Production builds still resolve cloudflare:workers
// through Wrangler.
import { extname } from "node:path";

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") {
    return {
      shortCircuit: true,
      url: "data:text/javascript,export%20class%20DurableObject%20%7Bconstructor(ctx%2Cenv)%7Bthis.ctx%3Dctx%3Bthis.env%3Denv%3B%7D%7D",
    };
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && extname(specifier) === "") {
    const candidate = new URL(`${specifier}.ts`, context.parentURL).href;
    try {
      return { shortCircuit: true, url: candidate };
    } catch {
      /* use the default resolver below */
    }
  }
  return nextResolve(specifier, context);
}
