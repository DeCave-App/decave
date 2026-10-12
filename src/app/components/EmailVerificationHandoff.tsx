import { useEffect, useState } from "react";

type VerificationState = "ready" | "sending" | "verified" | "error";

function tokenFromHash(hash: string): string {
  try {
    const token = new URLSearchParams(hash.replace(/^#/, "")).get("token") ?? "";
    return token.length > 0 && token.length <= 2048 ? token : "";
  } catch {
    return "";
  }
}

/** Show an explicit confirmation before sending a one-time email credential. */
export function EmailVerificationHandoff() {
  const [token] = useState(() => (typeof window === "undefined" ? "" : tokenFromHash(window.location.hash)));
  const [open, setOpen] = useState(Boolean(token));
  const [state, setState] = useState<VerificationState>("ready");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token || !window.location.hash) return;
    // Fragments are not sent to the Worker, but remove the credential from the
    // address bar and history as soon as React has captured it.
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
  }, [token]);

  if (!open) return null;

  const confirm = async () => {
    if (!token || state === "sending") return;
    setState("sending");
    setMessage("");
    try {
      const response = await fetch("/api/auth/verify-email", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setMessage(body.error || "This verification link is invalid or has expired.");
        setState("error");
        return;
      }
      setMessage("Your email is verified. You can now return to DeCave and sign in.");
      setState("verified");
    } catch {
      setMessage("We could not verify your email. Check your connection and try again.");
      setState("error");
    }
  };

  return (
    <div
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        display: "grid",
        placeItems: "center",
        padding: 20,
        background: "rgba(5, 9, 17, .82)",
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="email-verification-title"
        style={{
          width: "min(440px, 100%)",
          boxSizing: "border-box",
          padding: 28,
          border: "1px solid var(--ds-border, #273653)",
          borderRadius: 16,
          background: "var(--ds-surface-2, #10182a)",
          color: "var(--ds-text, #eef4ff)",
          boxShadow: "0 20px 60px rgba(0,0,0,.45)",
        }}
      >
        <h1 id="email-verification-title" style={{ margin: "0 0 10px", fontSize: 22 }}>
          {state === "verified" ? "Email verified" : "Verify your email"}
        </h1>
        <p aria-live="polite" style={{ margin: "0 0 20px", color: "var(--ds-text-soft, #aebbd0)" }}>
          {message || "Confirm this address to activate your DeCave account."}
        </p>
        {state !== "verified" && token && (
          <button
            type="button"
            onClick={confirm}
            disabled={state === "sending"}
            style={{
              minHeight: 42,
              padding: "0 16px",
              border: 0,
              borderRadius: 10,
              background: "var(--ds-accent, #5fe1ff)",
              color: "var(--ds-on-accent, #06111b)",
              fontWeight: 800,
              cursor: state === "sending" ? "wait" : "pointer",
            }}
          >
            {state === "sending" ? "Verifying…" : "Confirm email"}
          </button>
        )}
        {(state === "verified" || state === "error") && (
          <button
            type="button"
            onClick={() => setOpen(false)}
            style={{
              minHeight: 42,
              marginLeft: 10,
              padding: "0 16px",
              border: "1px solid var(--ds-border, #273653)",
              borderRadius: 10,
              background: "transparent",
              color: "var(--ds-text, #eef4ff)",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Return to DeCave
          </button>
        )}
      </section>
    </div>
  );
}
