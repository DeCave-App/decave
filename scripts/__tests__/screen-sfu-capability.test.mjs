import test from "node:test";
import assert from "node:assert/strict";
import { screenSfuCapable, DecryptHealth } from "../../src/voice/screen-sfu/capability.ts";

const ok = { RTCRtpScriptTransform: class {}, e2eeReady: true, sfuOffered: true };

test("capable only when all three hold", () => {
  assert.equal(screenSfuCapable(ok), true);
  assert.equal(screenSfuCapable({ ...ok, RTCRtpScriptTransform: undefined }), false);
  assert.equal(screenSfuCapable({ ...ok, e2eeReady: false }), false);
  assert.equal(screenSfuCapable({ ...ok, sfuOffered: false }), false);
});

test("DecryptHealth throttles failures to 1/s and reports first success after failure", () => {
  const h = new DecryptHealth();
  assert.equal(h.onFailure(1000), true);
  assert.equal(h.onFailure(1500), false);
  assert.equal(h.onFailure(2000), true);
  assert.equal(h.onSuccess(), true);
  assert.equal(h.onSuccess(), false);
});

test("DecryptHealth success with no prior failure is silent", () => {
  assert.equal(new DecryptHealth().onSuccess(), false);
});
