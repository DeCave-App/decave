// Liquid Glass on the phone: the saved setting, the glass colors, and that
// every backdrop the settings offer has a picture in the app bundle.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const { normalizeGlass, glassSurfaces, withAlpha, GLASS_BACKDROPS, DEFAULT_GLASS } =
  await import("../../mobile/src/lib/glass-model.ts");

test("glass is off by default and keeps only known values", () => {
  assert.deepEqual(normalizeGlass(undefined), DEFAULT_GLASS);
  assert.deepEqual(normalizeGlass({ enabled: "yes", style: "neon", backdrop: "space" }), DEFAULT_GLASS);
  assert.deepEqual(normalizeGlass({ enabled: true, style: "tinted", backdrop: "ocean" }), {
    enabled: true,
    style: "tinted",
    backdrop: "ocean",
  });
});

test("glass pages are see-through and panels keep some opacity", () => {
  const base = { bg: "#11080B", panel: "#1A0D12", panel2: "#24121A", nav: "rgba(20, 17, 29, 0.96)", border: "#333333" };
  for (const style of ["clear", "tinted"]) {
    const glass = glassSurfaces(base, style);
    assert.equal(glass.bg, "transparent");
    for (const key of ["panel", "panel2", "nav", "input"]) assert.match(glass[key], /^rgba\(/, `${style} ${key}`);
  }
  assert.equal(glassSurfaces(base, "tinted").panel, "rgba(26, 13, 18, 0.66)");
});

test("withAlpha reads hex and rgba colors", () => {
  assert.equal(withAlpha("#FF0080", 0.5), "rgba(255, 0, 128, 0.5)");
  assert.equal(withAlpha("rgba(20, 17, 29, 0.96)", 0.4), "rgba(20, 17, 29, 0.4)");
});

test("every backdrop and skin has a picture", () => {
  const source = fs.readFileSync(new URL("../../mobile/src/components/GlassBackdrop.tsx", import.meta.url), "utf8");
  for (const backdrop of GLASS_BACKDROPS.filter((id) => id !== "skin")) {
    assert.match(source, new RegExp(`${backdrop}: require\\("../../assets/glass/${backdrop}\\.jpg"\\)`));
  }
  for (const file of source.matchAll(/require\("\.\.\/\.\.\/(assets\/glass\/[\w-]+\.jpg)"\)/g)) {
    assert.ok(fs.existsSync(new URL(`../../mobile/${file[1]}`, import.meta.url)), file[1]);
  }
  const skins = fs.readFileSync(new URL("../../mobile/src/skins-data.ts", import.meta.url), "utf8");
  for (const id of skins.matchAll(/\bid: "([a-z]+)"/g)) assert.match(source, new RegExp(`skin-${id[1]}\\.jpg`), id[1]);
});
