import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..", "..");
const require = createRequire(import.meta.url);
const mobileRequire = createRequire(path.join(root, "mobile", "package.json"));
const decoderPath = path.join(root, "vendor", "decode-uri-component", "index.js");
const decode = require(decoderPath);
let queryStringPath;

try {
  queryStringPath = mobileRequire.resolve("query-string");
} catch (error) {
  if (error.code !== "MODULE_NOT_FOUND") {
    throw error;
  }
}

test("the compatibility fork preserves valid and malformed URI decoding", () => {
  assert.equal(decode("st%C3%A5le"), "ståle");
  assert.equal(decode("a+b"), "a b");
  assert.equal(decode("%2B"), "+");
  assert.equal(decode("%F0%9F%41"), "%F0%9FA");
  assert.equal(decode("%E0%80%80"), "%E0%80%80");
  assert.equal(decode("%FE%FF%41"), "\uFFFD\uFFFD%41");
  assert.equal(decode("%41%FE%FF"), "%41\uFFFD\uFFFD");
  assert.equal(decode("prefix%C2suffix"), "prefix\uFFFDsuffix");
  assert.throws(() => decode(null), {
    name: "TypeError",
    message: "Expected `encodedURI` to be of type `string`, got `object`",
  });
});

test("many distinct malformed runs decode within a bounded time", () => {
  const script = String.raw`
    const decoderPath = process.argv[1];
    const decode = require(decoderPath);
    const hex = value => value.toString(16).padStart(2, '0');
    const count = 24000;
    const runs = new Array(count);
    for (let i = 0; i < count; i++) {
      runs[i] = '%41%' + hex((i >> 8) & 255) + '%' + hex(i & 255) + '%80%80';
    }
    const input = runs.join('%G0');
    const output = decode(input);
    if (output.length >= input.length) throw new Error('malformed runs were not transformed');
    process.stdout.write(String(output.length));
  `;
  const result = spawnSync(process.execPath, ["-e", script, decoderPath], {
    encoding: "utf8",
    timeout: 3000,
  });

  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(Number(result.stdout) > 0);
});

test("query-string's CommonJS decoder contract handles valid and malformed input", { skip: !queryStringPath }, () => {
  const script = String.raw`
    const { createRequire } = require('node:module');
    const queryStringPath = process.argv[1];
    const queryRequire = createRequire(queryStringPath);
    const queryString = require(queryStringPath);
    const decoderInfo = queryRequire('decode-uri-component/package.json');
    if (decoderInfo.version !== '0.5.0-gamerchat.1') {
      throw new Error('query-string did not load the compatibility fork: ' + decoderInfo.version);
    }
    const ordinary = queryString.parse(
      'name=st%C3%A5le&greeting=hello+world&x=%2B&broken=%F0%9F%41&bad=%G0%20&truncated=%F0%9F%98&duplicate=one&duplicate=two&escaped=%25'
    );
    const malformed = queryString.parse('value=' + '%E0%80%80'.repeat(256));
    process.stdout.write(JSON.stringify({ ordinary, malformed: malformed.value }));
  `;
  const result = spawnSync(process.execPath, ["-e", script, queryStringPath], {
    encoding: "utf8",
    timeout: 3000,
    maxBuffer: 1024 * 1024,
  });

  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    ordinary: {
      name: "ståle",
      greeting: "hello world",
      x: "+",
      broken: "%F0%9FA",
      bad: "%G0 ",
      truncated: "%F0%9F%98",
      duplicate: ["one", "two"],
      escaped: "%",
    },
    malformed: "%E0%80%80".repeat(256),
  });
});
