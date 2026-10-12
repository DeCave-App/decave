// An ordered list of conditions or actions with add, remove and move.
import { CATALOGUE } from "../../../shared/bots/catalogue.ts";
import type { BotRuleError } from "../../../shared/bots/schema.ts";
import type { FieldEnv } from "./FieldInput";
import { PartEditor } from "./PartEditor";

type Part = { type: string } & Record<string, unknown>;

type Props = {
  kind: "conditions" | "actions";
  items: Part[];
  /** Error path of the list, e.g. "then" or "when.all". */
  path: string;
  errors: BotRuleError[];
  env: FieldEnv;
  limit: number;
  addLabel: string;
  makeDefault: (type: string) => Part;
  onChange: (items: Part[]) => void;
};

export function PartList({ kind, items, path, errors, env, limit, addLabel, makeDefault, onChange }: Props) {
  const types = Object.keys(CATALOGUE[kind]);
  const replace = (i: number, next: Part) => onChange(items.map((p, j) => (j === i ? next : p)));
  const move = (i: number, delta: number) => {
    const list = [...items];
    [list[i], list[i + delta]] = [list[i + delta], list[i]];
    onChange(list);
  };
  const listError = errors.find((e) => e.path === path)?.message;
  return (
    <div className="bb-partlist">
      {items.map((item, i) => (
        <PartEditor
          key={i}
          kind={kind}
          value={item}
          path={`${path}[${i}]`}
          errors={errors}
          env={env}
          onChange={(next) => replace(i, next)}
          onTypeChange={(type) => replace(i, makeDefault(type))}
          tools={
            <>
              {kind === "actions" && items.length > 1 && (
                <>
                  <button
                    type="button"
                    className="dcx-btn dcx-btn-sm dcx-btn-ghost"
                    aria-label="Move up"
                    title="Move up"
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="dcx-btn dcx-btn-sm dcx-btn-ghost"
                    aria-label="Move down"
                    title="Move down"
                    disabled={i === items.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    ↓
                  </button>
                </>
              )}
              <button
                type="button"
                className="dcx-btn dcx-btn-sm dcx-btn-ghost"
                aria-label="Remove"
                title="Remove"
                onClick={() => onChange(items.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </>
          }
        />
      ))}
      {listError && (
        <small className="bb-error" role="alert">
          {listError}
        </small>
      )}
      <button
        type="button"
        className="dcx-btn dcx-btn-sm bb-add"
        disabled={items.length >= limit}
        onClick={() => onChange([...items, makeDefault(types[0])])}
      >
        {addLabel}
      </button>
    </div>
  );
}
