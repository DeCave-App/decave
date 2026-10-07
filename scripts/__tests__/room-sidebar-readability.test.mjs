import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readAppSource } from "./app-source.mjs";

const css = readFileSync(new URL("../../src/styles/app-rework.css", import.meta.url), "utf8");
const appSource = readAppSource();
const compactHubStyles = css.slice(
  css.indexOf("/* Compact reference composition"),
  css.indexOf(".app[data-skin] > .server-bar", css.indexOf("/* Compact reference composition")),
);
const finalInlineHubStyles = appSource.slice(
  appSource.indexOf("/* Hub-owned controls must follow"),
  appSource.indexOf(
    '.app[data-skin][data-workspace="hub"] > main.dc-primary-workspace',
    appSource.indexOf("/* Hub-owned controls must follow"),
  ),
);

test("compact Hub room buttons keep readable desktop states", () => {
  assert.match(compactHubStyles, /@media \(min-width: 1201px\)/);
  assert.match(
    compactHubStyles,
    /\.channel-section \.channel \{[\s\S]*min-height: 44px !important;[\s\S]*background: var\(--gc-bg-2\) !important;[\s\S]*font-size: 13px !important;/,
  );
  assert.match(
    compactHubStyles,
    /\.channel-section \.channel > span:first-child \{[\s\S]*color: var\(--gc-accent-2\) !important;/,
  );
  assert.match(compactHubStyles, /\.channel-section \.channel:focus-visible \{[\s\S]*outline: 3px solid/);
  assert.match(
    compactHubStyles,
    /\.channel-section \.channel\.selected \{[\s\S]*background: var\(--gc-active\) !important;/,
  );
  assert.match(
    compactHubStyles,
    /\.channel-section\s+\.channel:has\(\.dc-private-room-lock\):not\(\.selected\) \{[\s\S]*background: var\(--gc-bg-1\) !important;/,
  );
});

test("the final inline Hub skin preserves the full sidebar banner layer", () => {
  assert.match(
    finalInlineHubStyles,
    /\.channel-sidebar \{[\s\S]*background-color: var\(--gc-bg-1\) !important;[\s\S]*background-image:[\s\S]*var\(--hub-cover-image\)/,
  );
  assert.doesNotMatch(finalInlineHubStyles, /\.channel-sidebar \{\s*background: var\(--gc-bg-1\) !important;/);
  assert.match(finalInlineHubStyles, /\.channel\.selected \{[\s\S]*background: var\(--gc-active\) !important;/);
});
