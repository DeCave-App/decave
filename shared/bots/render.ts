// Bot message text templates. Pure: no I/O. Resolves the innermost {...} first.
import { BOT_LIMITS } from "./types.ts";

type Vars = Record<string, string | number | undefined>;

const MAX_PASSES = 10;
const INNERMOST = /\{([^{}]*)\}/g;
// Resolved values are parked behind sentinels so braces in user data are never re-expanded.
const OPEN = "";
const CLOSE = "";
const SENTINEL = new RegExp(`${OPEN}(\\d+)${CLOSE}`, "g");
const STRIP = new RegExp(`[${OPEN}${CLOSE}]`, "g");
const ZERO_WIDTH_SPACE = "​";

export function renderTemplate(text: string, vars: Vars, rng: () => number = Math.random): string {
  const parked: string[] = [];
  const park = (value: string) => `${OPEN}${parked.push(value) - 1}${CLOSE}`;
  const expand = (s: string) => s.replace(SENTINEL, (_, i) => parked[Number(i)] ?? "");

  const evaluate = (rawExpr: string): string => {
    const expr = expand(rawExpr).trim();
    const choice = /^random:(.*)$/s.exec(expr);
    if (choice) {
      const options = choice[1].split("|");
      return options[Math.min(options.length - 1, Math.floor(rng() * options.length))];
    }
    const range = /^random\s+(-?\d+)\s*-\s*(-?\d+)$/.exec(expr);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      return String(lo + Math.min(hi - lo, Math.floor(rng() * (hi - lo + 1))));
    }
    if (expr === "date") return new Date().toISOString().slice(0, 10);

    const [name, ...filters] = expr.split("|");
    const key = name.trim();
    // Own properties only: {constructor}, {__proto__} etc. must not reach Object.prototype.
    const raw = Object.hasOwn(vars, key) ? vars[key] : undefined;
    let value = raw === undefined || raw === null ? "" : String(raw).replace(STRIP, "");
    for (const filter of filters) {
      const f = filter.trim();
      if (f === "upper") value = value.toUpperCase();
      else if (f === "lower") value = value.toLowerCase();
      else if (f.startsWith("default:")) {
        if (value === "") value = f.slice("default:".length);
      }
    }
    return value;
  };

  let out = text.replace(STRIP, "");
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let changed = false;
    out = out.replace(INNERMOST, (_, expr: string) => {
      changed = true;
      return park(evaluate(expr));
    });
    if (!changed) break;
  }

  out = expand(out)
    .replace(/@(everyone|here)/gi, `@${ZERO_WIDTH_SPACE}$1`)
    .slice(0, BOT_LIMITS.renderMaxChars);
  // Do not leave half of a surrogate pair at the cap.
  if (/[\uD800-\uDBFF]$/.test(out)) out = out.slice(0, -1);
  return out;
}
