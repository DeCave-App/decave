import assert from "node:assert/strict";
import test from "node:test";
import { compileBotPattern } from "../../shared/bots/regex-vm.ts";

const R = String.raw;

const PATTERNS = [
  R`^!roll \d+$`,
  R`gg+`,
  R`^hello (world|there)$`,
  R`\bdeal\b.*done`,
  R`colou?r`,
  R`^[a-z]{2,5}$`,
  R`lol+`,
  R`roll (\d+)`,
  R`[(a+)]+`,
  R`\(ok\)`,
  R`^(?:hi|hey|yo) (\w+)`,
  R`(\d+)-(\d{1,3})`,
  R`[^aeiou ]{3}`,
  R`\Bing\b`,
  R`a{3}`,
  R`a{2,}`,
  R`x{0,4}y`,
  R`\s+$`,
  R`^\S+`,
  R`[A-Z][a-z]*`,
  R`(cat|dog)s?`,
  R`.`,
  R`a.c`,
  R`^$`,
  R`\W`,
  R`\D{2}`,
  R`[\d.]+`,
  R`[-a]`,
  R`[a-]x`,
  R`(a|ab)(c|bcd)(d*)`,
  R`(x|z)y`,
  R`!help (me|us)`,
  R`(\w)\w?z`,
  R`\$\d+\.\d{2}`,
  R`[^\s]+@`,
  R`^\w+\b`,
  R`gg (ez|wp)\b`,
  R`\t\w+`,
  R`(?:a|b)(c)`,
  R`a?b?c?d?e?f?`,
];

const INPUTS = [
  "",
  "!roll 20",
  "!roll 20x",
  "gg wp",
  "GGGG ez",
  "hello world",
  "Hello There",
  "the deal is done",
  "ideal done",
  "color colour COLOR",
  "abcde",
  "roll 42 and roll 7",
  "(a+)",
  "say (ok) now",
  "hi Bob",
  "Yo friend",
  "12-34 and 5-6",
  "singing ring",
  "aaaa",
  "xxxxxy",
  "trailing   ",
  "Big Cats and dogs",
  "a\nc abc",
  "$12.50 $3",
  "mail me@x.y",
  "abcd",
  "-a- ax",
  "xy y",
  "ab z",
  "\tTab",
  "bc",
];

const js = (p, flags, s) => {
  const m = new RegExp(p, flags).exec(s);
  return m ? { index: m.index, groups: [...m] } : null;
};

test("regex VM matches JS RegExp on accepted patterns", () => {
  for (const p of PATTERNS) {
    for (const ci of [false, true]) {
      const matcher = compileBotPattern(p, { caseInsensitive: ci });
      assert.ok(!("error" in matcher), `${p}: ${matcher.error}`);
      for (const s of INPUTS) {
        assert.deepEqual(matcher.exec(s), js(p, ci ? "i" : "", s), `${p} /${ci ? "i" : ""} on ${JSON.stringify(s)}`);
      }
    }
  }
});

const fill = (unit, max) => {
  let s = "";
  while ((s + unit).length <= max) s += unit;
  return s;
};
const ADVERSARIAL = ["a", "x", " ", "aA", "1", "ab", "a "].flatMap((c) => {
  const s = c.repeat(500).slice(0, 500);
  return [s, s.slice(0, 499) + "!"];
});

const timed = (p) => {
  for (const ci of [false, true]) {
    const matcher = compileBotPattern(p, { caseInsensitive: ci });
    if ("error" in matcher) return;
    for (const s of ADVERSARIAL) {
      // Best of 3 so a busy parallel test run doesn't make this flaky.
      let ms = Infinity;
      for (let k = 0; k < 3; k++) {
        const start = performance.now();
        matcher.exec(s);
        ms = Math.min(ms, performance.now() - start);
      }
      assert.ok(ms < 20, `${p.slice(0, 40)} took ${ms.toFixed(1)} ms`);
    }
  }
};

test("regex VM: review repros finish fast on 500-char adversarial input", () => {
  const repros = [
    R`.*a?a?a?a?` + fill(R`.{10}`, 186) + "!",
    R`.*(a|a|a|a)(a|a|a|a)` + fill(R`a{10}`, 200 - 26) + "!",
    R`.*(a|a|a|a)(a|a|a|a)` + fill("a", 200 - 26) + "!",
    R`.*` + fill("a", 197) + "!",
    R`a*` + fill(R`a{10}`, 196) + "!",
    R`\w*` + fill(R`\w{10}`, 196) + "!",
    R`.{0,10}a?a?a?a?a?` + fill(R`.{10}`, 180) + "!",
    R`(a|a|a|a|a|a|a|a)(a|a|a|a)` + fill(R`a{10}`, 160) + "!",
    fill("a", 199) + "!",
    R`\s*` + fill(R`\s{10}`, 196) + "!",
    "a?".repeat(20) + "a".repeat(20) + ".*x",
  ];
  for (const p of repros) {
    assert.equal(compileBotPattern(p).error, undefined, p.slice(0, 40));
    timed(p);
  }
});

test("regex VM: generated accepted patterns all finish fast", () => {
  const parts = ["a", "a?", "a*", "a+", ".", ".*", ".?", "a{0,10}", "a{10}", ".{10}", "\\w{10}", "[a-z]?"];
  parts.push("(a|a)", "(a|aa)", "(?:a|a|a)", "\\w?", "\\s*", "x", "a{2,4}", "\\b", "$", "^", "(a+)", "\\d{1,10}");
  let seed = 7;
  const rand = (n) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  let accepted = 0;
  for (let k = 0; accepted < 300 && k < 20000; k++) {
    let p = "";
    const len = 5 + rand(40);
    for (let j = 0; j < len && p.length < 190; j++) p += parts[rand(parts.length)];
    if ("error" in compileBotPattern(p)) continue;
    accepted++;
    timed(p);
  }
  assert.equal(accepted, 300);
});

test("regex VM: grammar refusals and messages", () => {
  const bad = [".{0,2000}x", "a+a+b", "(ab)+", "(a|b)*", "(?=x)", "(a)\\1", "((a))", "(a+|b)", "a|b", "[a-z", "a+?"];
  for (const p of bad) assert.ok("error" in compileBotPattern(p), p);
  assert.equal(compileBotPattern(".{0,2000}x").error, "Repeat counts above 10 aren't allowed.");
});
