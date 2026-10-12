// The Test tab: run one rule's saved draft against example input and list each
// step the bot would take. The server dry-runs it: nothing is sent or changed.
import { useEffect, useMemo, useState } from "react";
import type { BotsApi, DryRunStep } from "./api";
import { ruleLabel, ruleToSentence, sampleEvent, type BotNames, type HubRef } from "./model.ts";
import type { LocalRule } from "./useRuleDrafts";

type Props = {
  api: BotsApi;
  botId: string;
  rules: LocalRule[];
  names: BotNames;
  textRooms: HubRef[];
};

export function TestTab({ api, botId, rules, names, textRooms }: Props) {
  const saved = rules.filter((r) => r.id);
  const [ruleId, setRuleId] = useState(saved[0]?.id ?? "");
  const rule = saved.find((r) => r.id === ruleId) ?? saved[0];
  const [roomId, setRoomId] = useState("");
  const [data, setData] = useState<Record<string, unknown>>({});
  const [steps, setSteps] = useState<DryRunStep[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const trigger = rule?.saved?.trigger ?? rule?.draft.trigger;
  const triggerKey = JSON.stringify(trigger ?? null);
  const sample = useMemo(() => (trigger ? sampleEvent(trigger) : null), [triggerKey]);
  useEffect(() => {
    setData(sample?.data ?? {});
    setSteps(null);
  }, [sample]);

  if (!rule || !sample || !trigger) return <p className="bb-empty">Add and save a rule first, then test it here.</p>;

  const args = (data.args ?? {}) as Record<string, string>;
  const runTest = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await api.test(botId, rule.id!, {
        kind: sample.kind,
        data,
        ...(roomId ? { roomId } : {}),
      });
      setSteps(result.steps);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The test could not run.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bb-test">
      <p className="bb-hint">Pick a rule, fill in example input and see each step. Nothing is sent or changed.</p>
      <div className="bb-fields">
        <div className="bb-field">
          <label className="bb-field-label" htmlFor="bb-test-rule">
            Rule
          </label>
          <select id="bb-test-rule" className="dcx-input" value={rule.id!} onChange={(e) => setRuleId(e.target.value)}>
            {saved.map((r) => (
              <option key={r.id} value={r.id!}>
                {ruleLabel(rules.indexOf(r))}: {ruleToSentence(r.draft, names).slice(0, 60)}
              </option>
            ))}
          </select>
        </div>
        <div className="bb-field">
          <label className="bb-field-label" htmlFor="bb-test-room">
            Happens in
          </label>
          <select id="bb-test-room" className="dcx-input" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
            <option value="">The first room</option>
            {textRooms.map((room) => (
              <option key={room.id} value={room.id}>
                #{room.name}
              </option>
            ))}
          </select>
        </div>
        {trigger.type === "command" &&
          trigger.options.map((option) => (
            <div className="bb-field" key={option.name}>
              <label className="bb-field-label" htmlFor={`bb-test-arg-${option.name}`}>
                /{trigger.name} {option.name}
              </label>
              <input
                id={`bb-test-arg-${option.name}`}
                className="dcx-input"
                value={args[option.name] ?? ""}
                onChange={(e) => setData({ ...data, args: { ...args, [option.name]: e.target.value } })}
              />
            </div>
          ))}
        {trigger.type === "message" && (
          <div className="bb-field wide">
            <label className="bb-field-label" htmlFor="bb-test-text">
              Message
            </label>
            <input
              id="bb-test-text"
              className="dcx-input"
              value={String(data.text ?? "")}
              onChange={(e) => setData({ ...data, text: e.target.value })}
            />
          </div>
        )}
        {trigger.type === "component" && (
          <div className="bb-field">
            <label className="bb-field-label" htmlFor="bb-test-value">
              Picked value
            </label>
            <input
              id="bb-test-value"
              className="dcx-input"
              value={String(data.value ?? "")}
              onChange={(e) => setData({ ...data, value: e.target.value })}
            />
          </div>
        )}
      </div>
      {rule.status !== "saved" && (
        <p className="dcx-notice dcx-notice-warn">
          This rule has edits that aren't saved yet; the test uses the last saved draft.
        </p>
      )}
      <button type="button" className="dcx-btn dcx-btn-primary" disabled={busy} onClick={() => void runTest()}>
        {busy ? "Running…" : "Run test"}
      </button>
      {error && <p className="dcx-notice dcx-notice-error">{error}</p>}
      {steps && (
        <ol className="bb-steps" aria-label="Test steps">
          {steps.length === 0 && (
            <li className="bb-hint">The rule didn't run: its trigger or conditions didn't match.</li>
          )}
          {steps.map((step, i) => (
            <li key={i} className={step.ok ? "ok" : "fail"}>
              <span className="bb-step-mark" aria-hidden="true">
                {step.ok ? "✓" : "✕"}
              </span>
              <span>
                {step.description}
                {step.reason && <small className="bb-error"> {step.reason}</small>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
