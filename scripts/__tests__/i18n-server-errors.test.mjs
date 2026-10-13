// Worker API errors are catalog codes, not English literals: no `error:` set
// from a string literal or passed through from a validator anywhere in
// worker/** (no allowlist), shared validators return codes, and every code
// passed to the error helpers exists in shared/i18n/locales/en/errors.json.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const errors = JSON.parse(fs.readFileSync(path.join(root, "shared/i18n/locales/en/errors.json"), "utf8"));

function workerSources(dir = path.join(root, "worker")) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return workerSources(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

const sources = workerSources().map((file) => ({
  file: path.relative(root, file).replaceAll("\\", "/"),
  text: fs.readFileSync(file, "utf8"),
}));

const lineOf = (text, index) => text.slice(0, index).split("\n").length;

// A code resolves to a string, or to plural forms ("x_one", "x_other") used as "x".
function hasCode(code) {
  const parts = code.split(".");
  const last = parts.pop();
  let node = errors;
  for (const part of parts) node = node && typeof node === "object" ? node[part] : undefined;
  if (!node || typeof node !== "object") return false;
  return typeof node[last] === "string" || typeof node[`${last}_other`] === "string";
}

test("worker sources build no error bodies from English literals", () => {
  // Any `error:` property set from a string literal, inside json(...) or not.
  const literal = /\berror:\s*["'`]/g;
  const found = [];
  for (const { file, text } of sources) {
    for (const match of text.matchAll(literal)) found.push(`${file}:${lineOf(text, match.index)}`);
  }
  assert.deepEqual(found, [], "use apiError(code, status) or apiErrorLegacy(legacyCode, i18nKey, status)");
});

test("worker sources pass no English error strings through without a code", () => {
  // `error: something.error`, `error: error.message`, `error: dimError`...: a
  // string from a validator sent on as-is. Only the helpers' own
  // `error: englishErrorText(...)` (next to the code) may set it, plus type
  // declarations (`error: string`).
  const passthrough = /\berror:\s*(?!englishErrorText\()(?!string\b)(?!unknown\b)[A-Za-z_$][\w$]*(?:\.[\w$]+)*\s*[,}]/g;
  const found = [];
  for (const { file, text } of sources) {
    for (const match of text.matchAll(passthrough)) found.push(`${file}:${lineOf(text, match.index)} ${match[0]}`);
  }
  assert.deepEqual(found, [], "send the validator's code: apiError(result.code, status, result.params)");
});

test("shared validators the Worker relies on return codes, not English", () => {
  const files = ["shared/forum.ts", "shared/hub-events.ts", "shared/streamer-mode.ts", "shared/streamer-pugs.ts"];
  const english = [
    /\berror:\s*["'`]/g,
    /new StreamerInputError\(\s*["'`]/g,
    /\bfail\(\s*"[^"]+",\s*"(?![a-zA-Z]+\.)/g,
    /\breturn\s+["'`][A-Z]/g,
  ];
  const found = [];
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    for (const pattern of english)
      for (const match of text.matchAll(pattern)) found.push(`${file}:${lineOf(text, match.index)} ${match[0]}`);
  }
  assert.deepEqual(found, []);
});

test("every Hub artwork size problem has an errors code with the same English", async () => {
  const { hubMediaDimensionProblem } = await import("../../shared/hub-media-specs.ts");
  const { englishErrorText } = await import("../../shared/i18n/error-code.ts");
  const sizes = [
    [0, 0],
    [100, 100],
    [10, 1000],
    [1000, 10],
    [4000, 4000],
  ];
  let checked = 0;
  for (const kind of ["banner", "header", "chat-background"]) {
    for (const [width, height] of sizes) {
      const problem = hubMediaDimensionProblem(kind, width, height);
      if (!problem) continue;
      checked += 1;
      assert.ok(hasCode(problem.code), problem.code);
      assert.equal(englishErrorText(problem.code, problem.params), problem.error);
    }
  }
  assert.ok(checked >= 9);
});

test("every error code the Worker sends exists in the English errors catalog", () => {
  const calls = [
    /\bapiError\(\s*"([^"]+)"/g,
    /\bapiErrorWithFields\(\s*"([^"]+)"/g,
    /\berrorFields\(\s*"([^"]+)"/g,
    /\brealtimeErrorFields\(\s*"([^"]+)"/g,
    /\bapiErrorLegacy\(\s*[^,()]+(?:\([^()]*\))?\s*,\s*"([^"]+)"/g,
    /\blegacyErrorFields\(\s*[^,()]+\s*,\s*"([^"]+)"/g,
  ];
  const missing = [];
  let checked = 0;
  for (const { file, text } of sources) {
    for (const pattern of calls) {
      for (const match of text.matchAll(pattern)) {
        checked += 1;
        if (!hasCode(match[1])) missing.push(`${file}:${lineOf(text, match.index)} ${match[1]}`);
      }
    }
  }
  assert.ok(checked > 400, `expected the scan to find the Worker's error calls, found ${checked}`);
  assert.deepEqual(missing, []);
});

test("worker success messages are server notices, not English literals", () => {
  // `message: "..."` (or a multi-line ternary of literals) next to no code:
  // send `...serverNotice(code)` so clients render it in the reader's language.
  const literal = /\bmessage:\s*(?:["'`]|\n(?:[^\n]*\n){0,2}?\s*\?\s*["'`])/g;
  const found = [];
  for (const { file, text } of sources) {
    for (const match of text.matchAll(literal)) {
      const line = text.slice(text.lastIndexOf("\n", match.index) + 1, text.indexOf("\n", match.index));
      if (/^\s*(?:\*|\/\/)/.test(line) || /\bcode:\s*"[a-z]+\.[\w.]+"/.test(line)) continue;
      found.push(`${file}:${lineOf(text, match.index)}`);
    }
  }
  assert.deepEqual(found, []);
});

test("account link result pages read their text from the catalog", () => {
  const settings = JSON.parse(fs.readFileSync(path.join(root, "shared/i18n/locales/en/settings.json"), "utf8"));
  const linkPage = settings.linkPage;
  assert.equal(typeof linkPage.closeTab, "string");
  assert.equal(typeof linkPage.openDeCave, "string");
  const callers = ["worker/twitch/subs.ts", "worker/faceit/links.ts", "worker/routes/integrations.ts"];
  const outcome = /(?:page\(env, request, [^,]+|linkResultPage\([^,]+\([^)]*\), "(\w+)"), "(\w+)"/g;
  let checked = 0;
  for (const file of callers) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    assert.doesNotMatch(text, /steamCallbackPage|CallbackPage\(\s*"/, file);
    const provider = file.includes("twitch") ? "twitch" : file.includes("faceit") ? "faceit" : "steam";
    for (const match of text.matchAll(outcome)) {
      const key = match[2];
      checked += 1;
      assert.equal(typeof linkPage[match[1] ?? provider]?.[key], "string", `${file} ${key}`);
      assert.equal(typeof linkPage[match[1] ?? provider]?.[`${key}Title`], "string", `${file} ${key}Title`);
    }
  }
  assert.ok(checked >= 16, `expected the link outcomes, found ${checked}`);
});
