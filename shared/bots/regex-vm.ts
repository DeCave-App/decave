// Linear-time matcher for bot regex triggers. Regex triggers run inside the
// single global HubRoom Durable Object, so they never go through JS RegExp
// (which backtracks). A pattern is parsed against a small whitelist grammar,
// compiled to an NFA program and run as a Pike VM (Thompson simulation with
// capture slots, leftmost-first thread priority to mimic JS semantics). Worst
// case is O(text length x program size), whatever the pattern.
//
// Grammar (anything else is refused):
//   atoms: literal chars, escaped punctuation, ., \d \w \s \D \W \S \n \t,
//          [classes] with ranges and ^ negation
//   anchors: ^ $ \b \B (never quantified)
//   repeats on a single atom only: ? * + {n} {n,m} {n,} with n, m <= 10,
//          never lazy or stacked
//   groups ( ) and (?: ): never quantified or nested; with | every choice is
//          non-empty plain atoms without repeats; no | outside a group
//   at most one open-ended repeat (* + {n,}); bounded repeats add at most 20
//          optional characters in total
//   no backreferences, lookarounds, named groups or inline flags

export const BOT_REGEX_MAX_PROGRAM = 2000;
const MAX_COUNT = 10;
const MAX_EXTRA = 20;
const SPECIAL = "\\^$.|?*+()[]{}";
const CLASS_ESCAPES = /[dwsDWSnt]/;

type CharTest = (c: string) => boolean;
type AssertKind = "^" | "$" | "b" | "B";
type Node =
  | { t: "char"; test: CharTest }
  | { t: "assert"; kind: AssertKind }
  | { t: "repeat"; test: CharTest; min: number; max: number }
  | { t: "group"; index: number | null; alts: Node[][] };

const isWord = (c: string | undefined) => c !== undefined && /[A-Za-z0-9_]/.test(c);
const isSpace = (c: string) => /\s/.test(c);
const isLineEnd = (c: string) => c === "\n" || c === "\r" || c === " " || c === " ";

function escapeTest(e: string): CharTest {
  switch (e) {
    case "d":
      return (c) => c >= "0" && c <= "9";
    case "D":
      return (c) => !(c >= "0" && c <= "9");
    case "w":
      return (c) => isWord(c);
    case "W":
      return (c) => !isWord(c);
    case "s":
      return isSpace;
    case "S":
      return (c) => !isSpace(c);
    case "n":
      return (c) => c === "\n";
    case "t":
      return (c) => c === "\t";
    default:
      return (c) => c === e;
  }
}

function fold(test: CharTest, caseInsensitive: boolean): CharTest {
  if (!caseInsensitive) return test;
  return (c) => test(c) || test(c.toLowerCase()) || test(c.toUpperCase());
}

class Parser {
  i = 0;
  groups = 0;
  unbounded = 0;
  extra = 0;
  readonly src: string;
  readonly ci: boolean;
  constructor(src: string, ci: boolean) {
    this.src = src;
    this.ci = ci;
  }

  fail(message: string): never {
    throw new BotRegexError(message);
  }

  // One single-character atom, or null if none starts at i.
  atom(): CharTest | null {
    const s = this.src;
    const ch = s[this.i];
    if (ch === undefined) return null;
    if (ch === "\\") {
      const next = s[this.i + 1];
      if (next === undefined) this.fail("A pattern can't end with \\.");
      if (next === "b" || next === "B") return null;
      if (/[1-9k]/.test(next)) this.fail("Backreferences are not allowed.");
      if (/[a-zA-Z0-9]/.test(next) && !CLASS_ESCAPES.test(next)) this.fail(`\\${next} is not allowed.`);
      this.i += 2;
      return fold(escapeTest(next), this.ci);
    }
    if (ch === "[") return this.charClass();
    if (ch === ".") {
      this.i++;
      return (c) => !isLineEnd(c);
    }
    if (SPECIAL.includes(ch)) return null;
    this.i++;
    return fold((c) => c === ch, this.ci);
  }

  charClass(): CharTest {
    const s = this.src;
    this.i++;
    const negate = s[this.i] === "^";
    if (negate) this.i++;
    if (s[this.i] === "]") this.fail("Empty [ ] classes are not allowed.");
    const parts: CharTest[] = [];
    // A single class member: an escape (test) or a plain char (string).
    const member = (): CharTest | string => {
      const c = s[this.i];
      if (c === "\\") {
        const next = s[this.i + 1];
        if (next === undefined || (/[a-zA-Z0-9]/.test(next) && !CLASS_ESCAPES.test(next)))
          this.fail("Only \\d \\w \\s \\D \\W \\S \\n \\t or escaped symbols inside [ ].");
        this.i += 2;
        if (next === "n") return "\n";
        if (next === "t") return "\t";
        return /[dwsDWS]/.test(next) ? escapeTest(next) : next;
      }
      if (c === "[") this.fail("Use \\[ for a literal [ inside [ ].");
      this.i++;
      return c;
    };
    while (this.i < s.length && s[this.i] !== "]") {
      const lo = member();
      if (typeof lo === "string" && s[this.i] === "-" && s[this.i + 1] !== undefined && s[this.i + 1] !== "]") {
        this.i++;
        const hi = member();
        if (typeof hi !== "string") this.fail("A range in [ ] needs a plain character on both sides.");
        if (hi < lo) this.fail("A range in [ ] is out of order.");
        parts.push((c) => c >= lo && c <= hi);
      } else parts.push(typeof lo === "string" ? (c) => c === lo : lo);
    }
    if (s[this.i] !== "]") this.fail("Unclosed [ ].");
    this.i++;
    const any = fold((c) => parts.some((p) => p(c)), this.ci);
    return negate ? (c) => !any(c) : any;
  }

  anchor(): AssertKind | null {
    const s = this.src;
    if (s[this.i] === "^" || s[this.i] === "$") return s[this.i++] as AssertKind;
    if (s[this.i] === "\\" && (s[this.i + 1] === "b" || s[this.i + 1] === "B")) {
      this.i += 2;
      return s[this.i - 1] as AssertKind;
    }
    return null;
  }

  // Optional repeat after an atom.
  repeat(): { min: number; max: number } | null {
    const s = this.src;
    const ch = s[this.i];
    let min: number;
    let max: number;
    if (ch === "*" || ch === "+") {
      min = ch === "+" ? 1 : 0;
      max = Infinity;
      this.i++;
    } else if (ch === "?") {
      min = 0;
      max = 1;
      this.i++;
    } else if (ch === "{") {
      const m = /^\{(\d{1,4})(,(\d{0,4}))?\}/.exec(s.slice(this.i));
      if (!m) this.fail("Use \\{ for a literal {.");
      min = Number(m[1]);
      max = m[2] === undefined ? min : m[3] === "" ? Infinity : Number(m[3]);
      if (min > MAX_COUNT || (max !== Infinity && max > MAX_COUNT))
        this.fail(`Repeat counts above ${MAX_COUNT} aren't allowed.`);
      if (max < min) this.fail("In {n,m}, m must be at least n.");
      this.i += m[0].length;
    } else return null;
    if (s[this.i] !== undefined && "?*+{".includes(s[this.i])) this.fail("A repeat can't be repeated or made lazy.");
    if (max === Infinity) this.unbounded++;
    else this.extra += max - min;
    return { min, max };
  }

  // Atoms (optionally repeated) and anchors up to | ) ( or the end.
  sequence(inGroup: boolean): Node[] {
    const s = this.src;
    const out: Node[] = [];
    while (this.i < s.length && s[this.i] !== "|" && s[this.i] !== ")" && s[this.i] !== "(") {
      const kind = this.anchor();
      if (kind) {
        out.push({ t: "assert", kind });
        continue;
      }
      const test = this.atom();
      if (!test) this.fail(`"${s[this.i]}" is not allowed here.`);
      const r = this.repeat();
      out.push(r ? { t: "repeat", test, ...r } : { t: "char", test });
    }
    if (inGroup && s[this.i] === "(") this.fail("Groups can't be nested.");
    return out;
  }

  group(): Node {
    const s = this.src;
    this.i++;
    let index: number | null = null;
    if (s[this.i] === "?") {
      if (s[this.i + 1] !== ":") this.fail("Lookarounds, named groups and inline flags are not allowed.");
      this.i += 2;
    } else index = ++this.groups;
    const alts = [this.sequence(true)];
    while (s[this.i] === "|") {
      this.i++;
      alts.push(this.sequence(true));
    }
    if (s[this.i] !== ")") this.fail("Unclosed ( ).");
    this.i++;
    if (alts.length === 1 && alts[0].length === 0) this.fail("Empty groups are not allowed.");
    if (alts.length > 1) {
      if (alts.some((a) => a.length === 0)) this.fail("Choices inside ( | ) can't be empty.");
      if (alts.some((a) => a.some((n) => n.t === "repeat")))
        this.fail("Choices inside ( | ) must be plain text without repeats.");
    }
    if (s[this.i] !== undefined && "?*+{".includes(s[this.i])) this.fail("Groups ( ) can't be repeated.");
    return { t: "group", index, alts };
  }

  parse(): Node[] {
    const s = this.src;
    const out: Node[] = [];
    while (this.i < s.length) {
      if (s[this.i] === "(") out.push(this.group());
      else if (s[this.i] === "|") this.fail("Put choices inside ( | ).");
      else if (s[this.i] === ")") this.fail("Unmatched ).");
      else out.push(...this.sequence(false));
    }
    if (this.unbounded > 1) this.fail("Use at most 1 open-ended repeat (*, + or {n,}).");
    if (this.extra > MAX_EXTRA)
      this.fail(`Bounded repeats (?, {n,m}) can add at most ${MAX_EXTRA} characters in total.`);
    return out;
  }
}

class BotRegexError extends Error {}

type Inst =
  | { op: "char"; test: CharTest }
  | { op: "split"; x: number; y: number }
  | { op: "jmp"; x: number }
  | { op: "save"; slot: number }
  | { op: "assert"; kind: AssertKind }
  | { op: "match" };

function compile(nodes: Node[]): Inst[] {
  const prog: Inst[] = [];
  const emit = (inst: Inst) => {
    if (prog.length >= BOT_REGEX_MAX_PROGRAM) throw new BotRegexError("Pattern is too complex.");
    prog.push(inst);
    return prog.length - 1;
  };
  const seq = (list: Node[]) => list.forEach(node);
  function node(n: Node) {
    if (n.t === "char") emit({ op: "char", test: n.test });
    else if (n.t === "assert") emit({ op: "assert", kind: n.kind });
    else if (n.t === "repeat") {
      for (let k = 0; k < n.min; k++) emit({ op: "char", test: n.test });
      if (n.max === Infinity) {
        // L: split body, end; body: char; jmp L
        const split = emit({ op: "split", x: 0, y: 0 });
        emit({ op: "char", test: n.test });
        emit({ op: "jmp", x: split });
        prog[split] = { op: "split", x: split + 1, y: prog.length };
      } else {
        // Nested optionals (greedy): split body, end; char; split ...; end
        const splits: number[] = [];
        for (let k = n.min; k < n.max; k++) {
          splits.push(emit({ op: "split", x: 0, y: 0 }));
          emit({ op: "char", test: n.test });
        }
        for (const at of splits) prog[at] = { op: "split", x: at + 1, y: prog.length };
      }
    } else {
      if (n.index !== null) emit({ op: "save", slot: n.index * 2 });
      const jumps: number[] = [];
      n.alts.forEach((alt, k) => {
        const last = k === n.alts.length - 1;
        const split = last ? -1 : emit({ op: "split", x: 0, y: 0 });
        seq(alt);
        if (!last) {
          jumps.push(emit({ op: "jmp", x: 0 }));
          prog[split] = { op: "split", x: split + 1, y: prog.length };
        }
      });
      for (const at of jumps) prog[at] = { op: "jmp", x: prog.length };
      if (n.index !== null) emit({ op: "save", slot: n.index * 2 + 1 });
    }
  }
  emit({ op: "save", slot: 0 });
  seq(nodes);
  emit({ op: "save", slot: 1 });
  emit({ op: "match" });
  return prog;
}

export interface BotRegexMatch {
  index: number;
  /** groups[0] is the whole match; unmatched groups are undefined. */
  groups: (string | undefined)[];
}

export interface BotRegexMatcher {
  exec(text: string): BotRegexMatch | null;
}

function run(prog: Inst[], slots: number, text: string): BotRegexMatch | null {
  const mark = new Int32Array(prog.length).fill(-1);
  let gen = 0;
  // Char tests are pure, so each instruction remembers its answer per char.
  const memo = prog.map(() => new Map<string, boolean>());
  const accepts = (pc: number, c: string) => {
    const inst = prog[pc] as { op: "char"; test: CharTest };
    let ok = memo[pc].get(c);
    if (ok === undefined) memo[pc].set(c, (ok = inst.test(c)));
    return ok;
  };
  const holds = (kind: AssertKind, pos: number) => {
    if (kind === "^") return pos === 0;
    if (kind === "$") return pos === text.length;
    const edge = isWord(text[pos - 1]) !== isWord(text[pos]);
    return kind === "b" ? edge : !edge;
  };
  // Follows non-consuming instructions in priority order; iterative so the
  // call stack stays flat. Threads land in pcs/caps lists.
  const stackPc: number[] = [];
  const stackCaps: Int32Array[] = [];
  const add = (pcs: number[], capsList: Int32Array[], startPc: number, startCaps: Int32Array, pos: number) => {
    stackPc.push(startPc);
    stackCaps.push(startCaps);
    while (stackPc.length) {
      const pc = stackPc.pop()!;
      const caps = stackCaps.pop()!;
      if (mark[pc] === gen) continue;
      mark[pc] = gen;
      const inst = prog[pc];
      if (inst.op === "jmp") {
        stackPc.push(inst.x);
        stackCaps.push(caps);
      } else if (inst.op === "split") {
        // Pushed in reverse so x (the preferred branch) is followed first.
        stackPc.push(inst.y, inst.x);
        stackCaps.push(caps, caps);
      } else if (inst.op === "save") {
        const next = caps.slice();
        next[inst.slot] = pos;
        stackPc.push(pc + 1);
        stackCaps.push(next);
      } else if (inst.op === "assert") {
        if (holds(inst.kind, pos)) {
          stackPc.push(pc + 1);
          stackCaps.push(caps);
        }
      } else {
        pcs.push(pc);
        capsList.push(caps);
      }
    }
  };
  let pcs: number[] = [];
  let capsList: Int32Array[] = [];
  let found: Int32Array | null = null;
  for (let pos = 0; pos <= text.length; pos++) {
    // A new attempt starting here has the lowest priority.
    if (!found) add(pcs, capsList, 0, new Int32Array(slots).fill(-1), pos);
    if (pcs.length === 0 && found) break;
    gen++;
    const nextPcs: number[] = [];
    const nextCaps: Int32Array[] = [];
    const c = text[pos];
    for (let t = 0; t < pcs.length; t++) {
      const pc = pcs[t];
      if (prog[pc].op === "match") {
        found = capsList[t];
        break; // lower-priority threads are cut
      }
      if (c !== undefined && accepts(pc, c)) add(nextPcs, nextCaps, pc + 1, capsList[t], pos + 1);
    }
    pcs = nextPcs;
    capsList = nextCaps;
  }
  if (!found) return null;
  const groups: (string | undefined)[] = [];
  for (let g = 0; g < slots / 2; g++) {
    const a = found[g * 2];
    const b = found[g * 2 + 1];
    groups.push(a >= 0 && b >= 0 ? text.slice(a, b) : undefined);
  }
  return { index: found[0], groups };
}

export function compileBotPattern(
  pattern: string,
  options: { caseInsensitive?: boolean } = {},
): BotRegexMatcher | { error: string } {
  try {
    const parser = new Parser(pattern, options.caseInsensitive ?? false);
    const nodes = parser.parse();
    const prog = compile(nodes);
    const slots = (parser.groups + 1) * 2;
    return { exec: (text: string) => run(prog, slots, text) };
  } catch (e) {
    if (e instanceof BotRegexError) return { error: e.message };
    throw e;
  }
}
