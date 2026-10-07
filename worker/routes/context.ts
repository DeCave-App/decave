// What every API route handler receives: the request, the Worker bindings and the
// parsed URL, path and method.

import type { Env } from "../lib/env";

export type ApiContext = {
  request: Request;
  env: Env;
  url: URL;
  p: string;
  method: string;
  /** Worker execution context, for work that may finish after the response (waitUntil). */
  ctx?: ExecutionContext;
};

export type ApiRouteHandler = (context: ApiContext) => Promise<Response | null>;
