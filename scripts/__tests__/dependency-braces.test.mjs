import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import Module, { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const patchedBracesPath = require.resolve("braces");
const patchedBraces = require("braces");
const upstreamInstall = join(repositoryRoot, "mobile/node_modules/braces");
const deepPattern = "{".repeat(4999) + "x" + "}".repeat(4999);

test("the installed package ships the security backport provenance", () => {
  const packageMetadata = JSON.parse(readFileSync(join(dirname(patchedBracesPath), "package.json"), "utf8"));

  assert.equal(packageMetadata.version, "3.0.4-decave.1");
  assert.equal(packageMetadata.private, true);
  assert.ok(packageMetadata.files.includes("SECURITY_BACKPORT.md"));
});

test("the unpatched 3.0.3 package reproduces stack exhaustion on deep expansion", (t) => {
  const upstreamPackage = join(upstreamInstall, "package.json");

  if (!existsSync(upstreamPackage)) {
    t.skip("mobile's unpatched braces install is not present in this checkout");
    return;
  }

  const packageMetadata = JSON.parse(readFileSync(upstreamPackage, "utf8"));
  if (packageMetadata.version !== "3.0.3" || existsSync(join(upstreamInstall, "SECURITY_BACKPORT.md"))) {
    t.skip("the installed braces package is not the vulnerable upstream baseline");
    return;
  }

  const source = "const braces=require(process.argv[1]); braces.expand(process.argv[2]);";
  const childEnv = { ...process.env };
  delete childEnv.NODE_PATH;
  // Fix the child stack budget so this baseline reproduction is stable across
  // hosts whose default V8 stack sizes differ.
  const result = spawnSync(process.execPath, ["--stack_size=256", "-e", source, upstreamInstall, deepPattern], {
    encoding: "utf8",
    env: childEnv,
    timeout: 15000,
    windowsHide: true,
  });

  assert.equal(result.error, undefined, result.error?.message);
  assert.notEqual(result.status, 0, "the unpatched implementation should crash in its recursive expansion walker");
  assert.match(`${result.stdout}${result.stderr}`, /Maximum call stack size exceeded/);
});

test("deep attacker-controlled brace and parenthesis patterns stop at the depth guard", () => {
  const deepBraces = "{".repeat(4999) + "x" + "}".repeat(4999);
  const deepParens = "(".repeat(4999) + "x" + ")".repeat(4999);

  assert.ok(deepBraces.length < 10000);
  assert.throws(() => patchedBraces(deepBraces), /Input depth .* exceeds max depth/);
  assert.throws(() => patchedBraces.expand(deepBraces), /Input depth .* exceeds max depth/);
  assert.throws(() => patchedBraces(deepParens), /Input depth .* exceeds max depth/);
});

test("all AST walkers bound caller-supplied trees and expansion rejects parent cycles", () => {
  let node = { type: "text", value: "x" };
  for (let depth = 0; depth < 101; depth += 1) {
    const parent = { type: "brace", nodes: [node] };
    node.parent = parent;
    node = parent;
  }
  const ast = { type: "root", nodes: [node] };
  node.parent = ast;

  assert.throws(() => patchedBraces.compile(ast), /exceeds max depth/);
  assert.throws(() => patchedBraces.expand(ast), /exceeds max depth/);
  assert.throws(() => patchedBraces.stringify(ast), /exceeds max depth/);

  const cyclic = { type: "group", nodes: [], queue: [] };
  cyclic.parent = cyclic;
  const cycleRoot = { type: "root", nodes: [cyclic] };
  cyclic.nodes.push({ type: "text", value: "x", parent: cyclic });
  assert.throws(() => patchedBraces.expand(cycleRoot), /parent chain contains a cycle/);
});

test("maxDepth is honored and capped without changing shallow expansion behavior", () => {
  assert.deepEqual(patchedBraces.expand("{a,b}"), ["a", "b"]);
  assert.throws(() => patchedBraces.parse("{{a,b},c}", { maxDepth: 1 }), /exceeds max depth/);
  assert.throws(() => patchedBraces.parse("{{a,b},c}", { maxDepth: 1.5 }), /exceeds max depth/);
  assert.throws(
    () => patchedBraces.parse("{".repeat(101) + "x" + "}".repeat(101), { maxDepth: 1000 }),
    /exceeds max depth/,
  );
});

test("common micromatch and Metro brace globs keep their normal expansions", () => {
  const patterns = [
    [
      "src/{components,features}/**/*.{js,ts,tsx}",
      [
        "src/components/**/*.js",
        "src/components/**/*.ts",
        "src/components/**/*.tsx",
        "src/features/**/*.js",
        "src/features/**/*.ts",
        "src/features/**/*.tsx",
      ],
    ],
    ["app/**/route.{js,jsx,ts,tsx}", ["app/**/route.js", "app/**/route.jsx", "app/**/route.ts", "app/**/route.tsx"]],
    [
      "assets/{icons,images}/**/*.{png,svg}",
      ["assets/icons/**/*.png", "assets/icons/**/*.svg", "assets/images/**/*.png", "assets/images/**/*.svg"],
    ],
    ["a/{b,{c,d}}/file", ["a/b/file", "a/c/file", "a/d/file"]],
  ];

  for (const [pattern, expected] of patterns) {
    assert.deepEqual(patchedBraces.expand(pattern), expected, pattern);
    assert.equal(patchedBraces(pattern).length, 1, `${pattern} should still compile to one glob expression`);
  }
});

test("micromatch keeps matching ordinary globs with the backported braces module", (t) => {
  const micromatchPath = join(repositoryRoot, "mobile/node_modules/micromatch/index.js");
  if (!existsSync(micromatchPath)) {
    t.skip("mobile's micromatch install is not present in this checkout");
    return;
  }

  const originalResolveFilename = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, ...args) {
    if (request === "braces" && parent?.filename === micromatchPath) {
      return patchedBracesPath;
    }

    return originalResolveFilename.call(this, request, parent, ...args);
  };

  try {
    const micromatch = require(micromatchPath);
    const pattern = "src/{components,features}/**/*.{js,ts,tsx}";

    assert.equal(micromatch.isMatch("src/components/Button.tsx", pattern), true);
    assert.equal(micromatch.isMatch("src/services/Button.tsx", pattern), false);
    assert.deepEqual(micromatch.braces(pattern, { expand: true }), [
      "src/components/**/*.js",
      "src/components/**/*.ts",
      "src/components/**/*.tsx",
      "src/features/**/*.js",
      "src/features/**/*.ts",
      "src/features/**/*.tsx",
    ]);
  } finally {
    Module._resolveFilename = originalResolveFilename;
  }
});
