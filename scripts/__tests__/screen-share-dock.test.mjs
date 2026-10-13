import test from "node:test";
import assert from "node:assert/strict";
import { readAppSource } from "./app-source.mjs";

const appSource = readAppSource();

test("active screen-sharing UI keeps explicit watching and trusted stream pop-outs", () => {
  assert.match(appSource, /\[screen\.connectionId\]: true/);
  assert.match(appSource, /t\("hub\.voiceStage\.startWatching"\)/);
  assert.match(
    appSource,
    /popOutStream\(\s*t\("hub\.voiceStage\.userScreenShareTitle", \{ name: screen\.username \}\),\s*screen\.stream,?\s*\)/,
  );
  const start = appSource.indexOf("const popOutStream =");
  const end = appSource.indexOf("const stopCamera", start);
  const popout = appSource.slice(start, end);
  assert.match(popout, /"about:blank",\s*"decave-stream"/);
  assert.match(popout, /video\.srcObject = stream/);
  assert.match(popout, /beforeunload[\s\S]*?video\.srcObject = null/);
  assert.doesNotMatch(popout, /innerHTML|document\.write|https?:/);
});
