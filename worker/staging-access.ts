export const STAGING_ACCESS_HEADER = "x-decave-staging-access";
export const STAGING_ACCESS_ENV = "STAGING_ACCESS_TOKEN";
export const MIN_STAGING_ACCESS_TOKEN_LENGTH = 43;

type StagingAccessEnv = {
  STAGING_ACCESS_TOKEN?: string;
};

function constantTimeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return mismatch === 0;
}

export function hasValidStagingAccess(request: Request, env: StagingAccessEnv): boolean {
  const expected = typeof env.STAGING_ACCESS_TOKEN === "string" ? env.STAGING_ACCESS_TOKEN.trim() : "";
  const presented = request.headers.get(STAGING_ACCESS_HEADER)?.trim() ?? "";
  if (expected.length < MIN_STAGING_ACCESS_TOKEN_LENGTH || presented.length < MIN_STAGING_ACCESS_TOKEN_LENGTH) {
    return false;
  }
  return constantTimeEqual(expected, presented);
}

export function stagingAccessDeniedResponse(): Response {
  return new Response("Not found", {
    status: 404,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
