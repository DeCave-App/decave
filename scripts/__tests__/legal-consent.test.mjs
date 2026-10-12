import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("the mobile copy of the legal consent versions matches shared/", () => {
  assert.equal(
    read("mobile/src/lib/legal-consent.ts"),
    read("shared/legal-consent.ts"),
    "mobile/src/lib/legal-consent.ts is out of date; copy shared/legal-consent.ts",
  );
});

test("web and mobile sign-up send the current consent versions", () => {
  assert.match(read("src/app/actions/auth.ts"), /\.\.\.currentLegalConsent\(\)/);
  assert.match(read("mobile/src/providers/SessionProvider.tsx"), /\.\.\.currentLegalConsent\(\)/);
});
