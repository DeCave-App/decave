import assert from "node:assert/strict";
import test from "node:test";
import {
  MIN_STAGING_ACCESS_TOKEN_LENGTH,
  STAGING_ACCESS_HEADER,
  hasValidStagingAccess,
  stagingAccessDeniedResponse,
} from "../../worker/staging-access.ts";

const token = "a".repeat(MIN_STAGING_ACCESS_TOKEN_LENGTH);

test("staging outer access fails closed for missing, short, and wrong headers", async () => {
  const env = { STAGING_ACCESS_TOKEN: token };
  assert.equal(hasValidStagingAccess(new Request("https://staging.invalid/"), env), false);
  assert.equal(
    hasValidStagingAccess(
      new Request("https://staging.invalid/", { headers: { [STAGING_ACCESS_HEADER]: "short" } }),
      env,
    ),
    false,
  );
  assert.equal(
    hasValidStagingAccess(
      new Request("https://staging.invalid/", { headers: { [STAGING_ACCESS_HEADER]: "b".repeat(token.length) } }),
      env,
    ),
    false,
  );
  assert.equal(
    hasValidStagingAccess(
      new Request("https://staging.invalid/", { headers: { [STAGING_ACCESS_HEADER]: token } }),
      env,
    ),
    true,
  );
  assert.equal(
    hasValidStagingAccess(new Request("https://staging.invalid/", { headers: { [STAGING_ACCESS_HEADER]: token } }), {}),
    false,
  );
  assert.equal((await stagingAccessDeniedResponse()).status, 404);
});
