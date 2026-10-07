import { useEffect, useState } from "react";
import QRCode from "qrcode";

type MfaStatus = { enabled: boolean; enabledAt: string | null; recoveryCodesRemaining: number };
type Step = "idle" | "password" | "scan" | "codes" | "disable" | "regenerate";

type Props = { apiBase: string };

async function post<T>(apiBase: string, path: string, body: unknown): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "Something went wrong. Try again.");
  return data;
}

/** Download recovery codes as a text file the user can keep offline. */
function downloadCodes(codes: string[]) {
  const text = `DeCave recovery codes\nEach code works once. Keep them somewhere safe.\n\n${codes.join("\n")}\n`;
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "decave-recovery-codes.txt";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Settings → Account: optional two-factor sign-in with an authenticator app. */
export function TwoFactorPanel({ apiBase }: Props) {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [secret, setSecret] = useState("");
  const [qr, setQr] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const load = async () => {
    try {
      const response = await fetch(`${apiBase}/api/account/mfa`, { credentials: "include" });
      if (response.ok) setStatus((await response.json()) as MfaStatus);
    } catch {
      /* Status stays unknown; the panel shows a retry. */
    }
  };
  useEffect(() => {
    void load();
  }, [apiBase]);

  const reset = (next: Step = "idle") => {
    setStep(next);
    setPassword("");
    setCode("");
    setError("");
    if (next === "idle") {
      setSecret("");
      setQr("");
    }
  };

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const startSetup = () =>
    run(async () => {
      const data = await post<{ secret: string; otpauth: string }>(apiBase, "/api/account/mfa/setup", {
        currentPassword: password,
      });
      setSecret(data.secret);
      setQr(
        await QRCode.toDataURL(data.otpauth, {
          width: 180,
          margin: 2,
          color: { dark: "#07101f", light: "#ffffff" },
          errorCorrectionLevel: "M",
        }),
      );
      setPassword("");
      setStep("scan");
    });

  const enable = () =>
    run(async () => {
      const data = await post<{ recoveryCodes: string[] }>(apiBase, "/api/account/mfa/enable", { code });
      setCodes(data.recoveryCodes);
      setSecret("");
      setQr("");
      setCode("");
      setStep("codes");
      await load();
    });

  const disable = () =>
    run(async () => {
      await post(apiBase, "/api/account/mfa/disable", { currentPassword: password, code });
      reset();
      await load();
    });

  const regenerate = () =>
    run(async () => {
      const data = await post<{ recoveryCodes: string[] }>(apiBase, "/api/account/mfa/recovery-codes", {
        currentPassword: password,
        code,
      });
      setCodes(data.recoveryCodes);
      setPassword("");
      setCode("");
      setStep("codes");
      await load();
    });

  const copyCodes = async () => {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked */
    }
  };

  const codeInput = (
    <label className="dcs-field">
      <span>Authenticator or recovery code</span>
      <input
        className="dcx-input"
        value={code}
        onChange={(event) => setCode(event.target.value.toUpperCase().replace(/\s/g, "").slice(0, 19))}
        inputMode="text"
        autoComplete="one-time-code"
        placeholder="123456"
      />
    </label>
  );
  const passwordInput = (
    <label className="dcs-field">
      <span>Current password</span>
      <input
        className="dcx-input"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoComplete="current-password"
      />
    </label>
  );

  return (
    <div className="dcs-card" data-mfa-enabled={status?.enabled ? "true" : "false"}>
      <div className="dcs-card-row">
        <span className={`dcs-badge${status?.enabled ? " is-on" : ""}`} aria-hidden="true">
          {status?.enabled ? "✓" : "!"}
        </span>
        <div className="dcs-card-copy">
          <strong>Two-factor sign-in</strong>
          <small>
            {status === null
              ? "Checking…"
              : status.enabled
                ? `On · ${status.recoveryCodesRemaining} recovery code${status.recoveryCodesRemaining === 1 ? "" : "s"} left`
                : "Off · Ask for a code from an authenticator app when you sign in on a new device."}
          </small>
        </div>
        {step === "idle" && status && !status.enabled && (
          <button type="button" className="modal-primary" onClick={() => reset("password")}>
            Turn on
          </button>
        )}
        {step === "idle" && status?.enabled && (
          <div className="dcs-card-actions">
            <button type="button" className="modal-secondary" onClick={() => reset("regenerate")}>
              New recovery codes
            </button>
            <button type="button" className="modal-secondary dcs-danger-text" onClick={() => reset("disable")}>
              Turn off
            </button>
          </div>
        )}
      </div>

      {status?.enabled && status.recoveryCodesRemaining <= 2 && step === "idle" && (
        <p className="dcs-warning">
          You are running out of recovery codes. Make a new set so you don't get locked out.
        </p>
      )}

      {step === "password" && (
        <div className="dcs-steps">
          <p>
            Install an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy…), then
            confirm your password to begin.
          </p>
          {passwordInput}
          <div className="dcs-card-actions">
            <button type="button" className="modal-secondary" onClick={() => reset()}>
              Cancel
            </button>
            <button
              type="button"
              className="modal-primary"
              disabled={busy || !password}
              onClick={() => void startSetup()}
            >
              {busy ? "Checking…" : "Continue"}
            </button>
          </div>
        </div>
      )}

      {step === "scan" && (
        <div className="dcs-steps dcs-mfa-scan">
          {qr && <img src={qr} width={180} height={180} alt="QR code for your authenticator app" />}
          <div>
            <p>
              <strong>1.</strong> Scan this code with your authenticator app.
            </p>
            <p>Can't scan? Enter this key instead:</p>
            <code className="dcs-secret">{secret.replace(/(.{4})/g, "$1 ").trim()}</code>
            <p>
              <strong>2.</strong> Type the 6-digit code the app shows.
            </p>
            <label className="dcs-field">
              <span>6-digit code</span>
              <input
                className="dcx-input"
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && code.length === 6) void enable();
                }}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
              />
            </label>
            <div className="dcs-card-actions">
              <button type="button" className="modal-secondary" onClick={() => reset()}>
                Cancel
              </button>
              <button
                type="button"
                className="modal-primary"
                disabled={busy || code.length !== 6}
                onClick={() => void enable()}
              >
                {busy ? "Checking…" : "Turn on two-factor"}
              </button>
            </div>
          </div>
        </div>
      )}

      {step === "codes" && (
        <div className="dcs-steps">
          <p className="dcs-warning">
            <strong>Save these recovery codes now.</strong> Each one works once if you lose your phone. You won't see
            them again.
          </p>
          <ul className="dcs-codes">
            {codes.map((value) => (
              <li key={value}>
                <code>{value}</code>
              </li>
            ))}
          </ul>
          <div className="dcs-card-actions">
            <button type="button" className="modal-secondary" onClick={() => void copyCodes()}>
              {copied ? "Copied" : "Copy"}
            </button>
            <button type="button" className="modal-secondary" onClick={() => downloadCodes(codes)}>
              Download .txt
            </button>
            <button
              type="button"
              className="modal-primary"
              onClick={() => {
                setCodes([]);
                reset();
              }}
            >
              I saved them
            </button>
          </div>
        </div>
      )}

      {(step === "disable" || step === "regenerate") && (
        <div className="dcs-steps">
          <p>
            {step === "disable"
              ? "Turning off two-factor makes your account easier to take over. Confirm it's you."
              : "Your old recovery codes stop working as soon as you make new ones. Confirm it's you."}
          </p>
          {passwordInput}
          {codeInput}
          <div className="dcs-card-actions">
            <button type="button" className="modal-secondary" onClick={() => reset()}>
              Cancel
            </button>
            <button
              type="button"
              className={step === "disable" ? "modal-secondary dcs-danger-text" : "modal-primary"}
              disabled={busy || !password || !code}
              onClick={() => void (step === "disable" ? disable() : regenerate())}
            >
              {busy ? "Checking…" : step === "disable" ? "Turn off two-factor" : "Make new codes"}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="dcs-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
