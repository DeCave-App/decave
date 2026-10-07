import assert from "node:assert/strict";
import test from "node:test";
import { readAppSource } from "./app-source.mjs";
import { readWorkerSource } from "./worker-source.mjs";

const appSource = readAppSource();
const workerSource = readWorkerSource();
const externalRenderStart = appSource.indexOf("if (external) {");
const externalRenderEnd = appSource.indexOf('if (widget.id === "nowPlaying")', externalRenderStart);
const externalRender = appSource.slice(externalRenderStart, externalRenderEnd);

test("external widget URLs are restricted before they reach the iframe", () => {
  assert.notEqual(externalRenderStart, -1, "external widget render branch is missing");
  assert.match(appSource, /parsed\.protocol !== "https:"/);
  assert.match(appSource, /parsed\.username/);
  assert.match(appSource, /parsed\.password/);
  assert.match(appSource, /parsed\.port/);
  assert.match(appSource, /localhost/);
  assert.match(appSource, /\.internal/);
  assert.match(appSource, /de-cave\.com/);
  assert.match(appSource, /MAX_EXTERNAL_HOME_WIDGET_URL_LENGTH = 2048/);
});

test("external widget content stays in a restrictive sandbox", () => {
  assert.match(externalRender, /!window\.decaveDesktop\?\.isDesktop &&\s*\(?\s*<iframe/);
  assert.match(externalRender, /sandbox="allow-scripts"/);
  assert.match(externalRender, /referrerPolicy="no-referrer"/);
  assert.match(externalRender, /rel="noopener noreferrer"/);
  assert.doesNotMatch(
    externalRender,
    /allow-same-origin|allow-forms|allow-popups|allow-top-navigation|srcDoc|dangerouslySetInnerHTML/,
  );
});

test("stored widget data is bounded and normalized", () => {
  assert.match(appSource, /MAX_EXTERNAL_HOME_WIDGETS = 12/);
  assert.match(appSource, /MAX_EXTERNAL_HOME_WIDGET_TITLE_LENGTH = 80/);
  assert.match(appSource, /value\.slice\(0, MAX_HOME_LAYOUT_ITEMS\)/);
  assert.match(appSource, /parseExternalHomeWidget\(rawItem\)/);
  assert.match(appSource, /seenIds\.has\(normalized\.id\)/);
  assert.match(appSource, /externalCount >= MAX_EXTERNAL_HOME_WIDGETS/);
});

test("the app CSP permits HTTPS frames without weakening page isolation", () => {
  assert.match(workerSource, /frame-src 'self' https:/);
  assert.match(workerSource, /frame-ancestors 'none'/);
  assert.match(workerSource, /form-action 'self'/);
  assert.match(workerSource, /X-Content-Type-Options/);
});
