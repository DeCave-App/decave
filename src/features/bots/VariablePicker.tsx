// "{ }" button next to a message field: inserts a variable at the cursor, and a
// live preview of the message with sample values.
import { useState, type RefObject } from "react";

export type BotVariable = { name: string; label: string; sample: string };

type Props = {
  variables: BotVariable[];
  inputRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  value: string;
  onChange: (next: string) => void;
};

export function VariablePicker({ variables, inputRef, value, onChange }: Props) {
  const [open, setOpen] = useState(false);

  const insert = (name: string) => {
    const token = `{${name}}`;
    const input = inputRef.current;
    const start = input?.selectionStart ?? value.length;
    const end = input?.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + token + value.slice(end));
    setOpen(false);
    requestAnimationFrame(() => {
      if (!input) return;
      input.focus();
      input.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return (
    <span className="bb-varpicker">
      <button
        type="button"
        className="dcx-btn dcx-btn-sm dcx-btn-ghost bb-varpicker-btn"
        aria-expanded={open}
        aria-label="Insert a variable"
        title="Insert a variable"
        onClick={() => setOpen((v) => !v)}
      >
        {"{ }"}
      </button>
      {open && (
        <span className="bb-varpicker-menu" role="menu">
          {variables.map((v) => (
            <button key={v.name} type="button" role="menuitem" onClick={() => insert(v.name)}>
              <code>{`{${v.name}}`}</code>
              <small>{v.label}</small>
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

/**
 * A light stand-in for the server renderer (shared/bots/render.ts needs ES2022):
 * innermost {…} first, random ranges show their low end, unknown names render empty.
 */
function previewTemplate(text: string, vars: Map<string, string>): string {
  let out = text;
  for (let pass = 0; pass < 10 && /\{[^{}]*\}/.test(out); pass++)
    out = out.replace(/\{([^{}]*)\}/g, (_, raw: string) => {
      const expr = raw.trim();
      const range = /^random\s+(-?\d+)\s*-\s*(-?\d+)$/.exec(expr);
      if (range) return range[1];
      if (expr.startsWith("random:")) return expr.slice("random:".length).split("|")[0];
      const [name, ...filters] = expr.split("|");
      let value = vars.get(name.trim()) ?? "";
      for (const filter of filters.map((f) => f.trim())) {
        if (filter === "upper") value = value.toUpperCase();
        else if (filter === "lower") value = value.toLowerCase();
        else if (filter.startsWith("default:") && !value) value = filter.slice("default:".length);
      }
      return value;
    });
  return out;
}

/** What the message looks like with sample values, shown under template fields. */
export function TemplatePreview({ text, variables }: { text: string; variables: BotVariable[] }) {
  if (!text.includes("{")) return null;
  const vars = new Map(variables.map((v) => [v.name, v.sample]));
  return (
    <small className="bb-preview" aria-label="Preview">
      Preview: {previewTemplate(text, vars)}
    </small>
  );
}
