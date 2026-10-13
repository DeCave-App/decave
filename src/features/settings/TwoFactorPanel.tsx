import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useSettingsT } from "./useSettingsT";
import { apiErrorOr, type ApiErrorBody } from "../../i18n/apiError";

export type MfaStatus = { enabled: boolean; enabledAt: string | null; recoveryCodesRemaining: number };
type Step = "idle" | "password" | "scan" | "codes" | "disable" | "regenerate";

type Props = {
  apiBase: string;
  /** Told whenever two-factor is checked, turned on or off (Your setup uses it). */
  onStatus?: (status: MfaStatus) => void;
};

async function post<T>(apiBase: string, path: string, body: unknown, fallback: string): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as T & ApiErrorBody;
  if (!response.ok) throw new Error(apiErrorOr(data, fallback));
  return data;
}

/** Download recovery codes as a text file the user can keep offline. */
function downloadCodes(codes: string[], header: string) {
  const text = `${header}\n\n${codes.join("\n")}\n`;
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "decave-recovery-codes.txt";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Settings → Account & devices: optional two-factor sign-in with an authenticator app. */
export function TwoFactorPanel({ apiBase, onStatus }: Props) {
  const { t } = useSettingsT();
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
  const failed = t("settings.twoFactor.errorRetry");

  const load = async () => {
    try {
      const response = await fetch(`${apiBase}/api/account/mfa`, { credentials: "include" });
      if (response.ok) {
        const next = (await response.json()) as MfaStatus;
        setStatus(next);
        onStatus?.(next);
      }
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
      setError(err instanceof Error ? err.message : t("settings.twoFactor.error"));
    } finally {
      setBusy(false);
    }
  };

  const startSetup = () =>
    run(async () => {
      const data = await post<{ secret: string; otpauth: string }>(
        apiBase,
        "/api/account/mfa/setup",
        { currentPassword: password },
        failed,
      );
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
      const data = await post<{ recoveryCodes: string[] }>(apiBase, "/api/account/mfa/enable", { code }, failed);
      setCodes(data.recoveryCodes);
      setSecret("");
      setQr("");
      setCode("");
      setStep("codes");
      await load();
    });

  const disable = () =>
    run(async () => {
      await post(apiBase, "/api/account/mfa/disable", { currentPassword: password, code }, failed);
      reset();
      await load();
    });

  const regenerate = () =>
    run(async () => {
      const data = await post<{ recoveryCodes: string[] }>(
        apiBase,
        "/api/account/mfa/recovery-codes",
        { currentPassword: password, code },
        failed,
      );
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
      <span>{t("settings.twoFactor.codeLabel")}</span>
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
      <span>{t("settings.twoFactor.currentPassword")}</span>
      <input
        className="dcx-input"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoComplete="current-password"
      />
    </label>
  );
  const checking = t("settings.twoFactor.checking");

  return (
    <div className="dcs-card" data-mfa-enabled={status?.enabled ? "true" : "false"}>
      <div className="dcs-card-row">
        <span className={`dcs-badge${status?.enabled ? " is-on" : ""}`} aria-hidden="true">
          {status?.enabled ? "✓" : "!"}
        </span>
        <div className="dcs-card-copy">
          <strong>{t("settings.twoFactor.title")}</strong>
          <small>
            {status === null
              ? checking
              : status.enabled
                ? t("settings.twoFactor.on", { count: status.recoveryCodesRemaining })
                : t("settings.twoFactor.off")}
          </small>
        </div>
        {step === "idle" && status && !status.enabled && (
          <button type="button" className="modal-primary" onClick={() => reset("password")}>
            {t("settings.twoFactor.turnOn")}
          </button>
        )}
        {step === "idle" && status?.enabled && (
          <div className="dcs-card-actions">
            <button type="button" className="modal-secondary" onClick={() => reset("regenerate")}>
              {t("settings.twoFactor.newCodes")}
            </button>
            <button type="button" className="modal-secondary dcs-danger-text" onClick={() => reset("disable")}>
              {t("settings.twoFactor.turnOff")}
            </button>
          </div>
        )}
      </div>

      {status?.enabled && status.recoveryCodesRemaining <= 2 && step === "idle" && (
        <p className="dcs-warning">{t("settings.twoFactor.runningOut")}</p>
      )}

      {step === "password" && (
        <div className="dcs-steps">
          <p>{t("settings.twoFactor.installApp")}</p>
          {passwordInput}
          <div className="dcs-card-actions">
            <button type="button" className="modal-secondary" onClick={() => reset()}>
              {t("settings.twoFactor.cancel")}
            </button>
            <button
              type="button"
              className="modal-primary"
              disabled={busy || !password}
              onClick={() => void startSetup()}
            >
              {busy ? checking : t("settings.twoFactor.continue")}
            </button>
          </div>
        </div>
      )}

      {step === "scan" && (
        <div className="dcs-steps dcs-mfa-scan">
          {qr && <img src={qr} width={180} height={180} alt={t("settings.twoFactor.qrAlt")} />}
          <div>
            <p>
              <strong>1.</strong> {t("settings.twoFactor.scan")}
            </p>
            <p>{t("settings.twoFactor.cantScan")}</p>
            <code className="dcs-secret">{secret.replace(/(.{4})/g, "$1 ").trim()}</code>
            <p>
              <strong>2.</strong> {t("settings.twoFactor.typeCode")}
            </p>
            <label className="dcs-field">
              <span>{t("settings.twoFactor.sixDigit")}</span>
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
                {t("settings.twoFactor.cancel")}
              </button>
              <button
                type="button"
                className="modal-primary"
                disabled={busy || code.length !== 6}
                onClick={() => void enable()}
              >
                {busy ? checking : t("settings.twoFactor.turnOnTwoFactor")}
              </button>
            </div>
          </div>
        </div>
      )}

      {step === "codes" && (
        <div className="dcs-steps">
          <p className="dcs-warning">
            <strong>{t("settings.twoFactor.saveCodesNow")}</strong> {t("settings.twoFactor.saveCodesDetail")}
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
              {copied ? t("settings.twoFactor.copied") : t("settings.twoFactor.copy")}
            </button>
            <button
              type="button"
              className="modal-secondary"
              onClick={() => downloadCodes(codes, t("settings.twoFactor.fileHeader"))}
            >
              {t("settings.twoFactor.downloadTxt")}
            </button>
            <button
              type="button"
              className="modal-primary"
              onClick={() => {
                setCodes([]);
                reset();
              }}
            >
              {t("settings.twoFactor.savedThem")}
            </button>
          </div>
        </div>
      )}

      {(step === "disable" || step === "regenerate") && (
        <div className="dcs-steps">
          <p>
            {step === "disable" ? t("settings.twoFactor.disableWarning") : t("settings.twoFactor.regenerateWarning")}
          </p>
          {passwordInput}
          {codeInput}
          <div className="dcs-card-actions">
            <button type="button" className="modal-secondary" onClick={() => reset()}>
              {t("settings.twoFactor.cancel")}
            </button>
            <button
              type="button"
              className={step === "disable" ? "modal-secondary dcs-danger-text" : "modal-primary"}
              disabled={busy || !password || !code}
              onClick={() => void (step === "disable" ? disable() : regenerate())}
            >
              {busy
                ? checking
                : step === "disable"
                  ? t("settings.twoFactor.turnOffTwoFactor")
                  : t("settings.twoFactor.makeNewCodes")}
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
