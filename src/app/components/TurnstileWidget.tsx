import { useEffect, useRef, useState } from "react";
import { hasDesktopActivityBridge, verifyDesktopHuman } from "../desktop";

type TurnstileApi = {
  render: (
    element: HTMLElement,
    options: {
      sitekey: string;
      action?: string;
      theme?: "dark" | "light" | "auto";
      appearance?: "always" | "execute" | "interaction-only";
      callback?: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: () => void;
    },
  ) => string;
  remove: (widgetId: string) => void;
};

export function TurnstileWidget({
  siteKey,
  action,
  nonce,
  onToken,
}: {
  siteKey: string;
  action: string;
  nonce: number;
  onToken: (token: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const desktopRuntime = hasDesktopActivityBridge();
  const [recoveryVisible, setRecoveryVisible] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [verificationState, setVerificationState] = useState<"loading" | "ready" | "verified" | "failed">("loading");

  useEffect(() => {
    if (!desktopRuntime) return;

    let disposed = false;
    onToken("");
    setRecoveryVisible(false);
    setVerificationState("loading");

    // The desktop main process keeps the challenge window hidden while
    // Turnstile attempts its managed check. It reveals that window itself if
    // Cloudflare needs a human interaction, so there is no manual verify
    // control in the login form.
    void verifyDesktopHuman(action)
      .then((token) => {
        if (disposed) return;
        if (token) {
          setVerificationState("verified");
          onToken(token);
        } else {
          setVerificationState("failed");
          setRecoveryVisible(true);
        }
      })
      .catch(() => {
        if (disposed) return;
        setVerificationState("failed");
        setRecoveryVisible(true);
      });

    return () => {
      disposed = true;
      onToken("");
    };
  }, [action, desktopRuntime, nonce, onToken, retryCount]);

  useEffect(() => {
    if (desktopRuntime) return;
    if (!siteKey || !hostRef.current) {
      setVerificationState("failed");
      setRecoveryVisible(true);
      onToken("");
      return;
    }

    let disposed = false;
    let widgetId = "";
    let loadTimeout: number | null = null;

    const showFailure = () => {
      if (disposed) return;
      if (loadTimeout !== null) {
        window.clearTimeout(loadTimeout);
        loadTimeout = null;
      }
      setVerificationState("failed");
      setRecoveryVisible(true);
      onToken("");
    };

    const handleToken = (token: string) => {
      if (token) {
        if (loadTimeout !== null) {
          window.clearTimeout(loadTimeout);
          loadTimeout = null;
        }
        setVerificationState("verified");
        onToken(token);
      } else {
        showFailure();
      }
    };

    const renderWidget = () => {
      if (disposed || !hostRef.current) return;
      const api = (window as Window & { turnstile?: TurnstileApi }).turnstile;
      if (!api) {
        showFailure();
        return;
      }

      try {
        widgetId = api.render(hostRef.current, {
          sitekey: siteKey,
          action,
          theme: "dark",
          // Keep the managed check out of the form during the normal path.
          // If Cloudflare needs interaction, the failure callback reveals the
          // same mounted widget in the inline recovery area below the fields.
          appearance: recoveryVisible ? "always" : "interaction-only",
          callback: handleToken,
          "expired-callback": showFailure,
          "error-callback": showFailure,
        });
        setVerificationState("ready");
      } catch {
        showFailure();
      }
    };

    const existing = document.querySelector<HTMLScriptElement>('script[data-decave-turnstile="1"]');

    if ((window as Window & { turnstile?: TurnstileApi }).turnstile) {
      renderWidget();
    } else if (existing) {
      existing.addEventListener("load", renderWidget, { once: true });
      existing.addEventListener("error", showFailure, { once: true });
    } else {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.dataset.decaveTurnstile = "1";
      script.addEventListener("load", renderWidget, { once: true });
      script.addEventListener("error", showFailure, { once: true });
      document.head.appendChild(script);
    }

    // Do not leave the form looking disabled forever if the challenge script
    // cannot load or Cloudflare never calls back.
    loadTimeout = window.setTimeout(showFailure, 12_000);

    return () => {
      disposed = true;
      if (loadTimeout !== null) window.clearTimeout(loadTimeout);
      const api = (window as Window & { turnstile?: TurnstileApi }).turnstile;
      if (widgetId && api) {
        try {
          api.remove(widgetId);
        } catch {}
      }
      onToken("");
    };
  }, [siteKey, action, nonce, onToken, desktopRuntime, recoveryVisible, retryCount]);

  if (desktopRuntime) {
    if (!recoveryVisible) return null;

    return (
      <div className="decave-turnstile-shell recovery" role="alert">
        <div className="decave-turnstile-meta">
          <span>SECURITY CHECK</span>
          <strong>Needs your attention</strong>
        </div>
        <p className="decave-turnstile-recovery-copy">
          Cloudflare could not finish in the background. Retry the security check to continue.
        </p>
        <button
          type="button"
          className="decave-turnstile-retry"
          onClick={() => {
            onToken("");
            setRecoveryVisible(false);
            setVerificationState("loading");
            setRetryCount((value) => value + 1);
          }}
        >
          Retry security check
        </button>
      </div>
    );
  }

  return (
    <div
      className={`decave-turnstile-shell${recoveryVisible ? " recovery" : " background"}`}
      aria-hidden={!recoveryVisible}
    >
      <div ref={hostRef} className="decave-turnstile-host" />
      {recoveryVisible && (
        <>
          <div className="decave-turnstile-meta">
            <span>SECURITY CHECK</span>
            <strong>{verificationState === "verified" ? "Verified" : "Needs your attention"}</strong>
          </div>
          {verificationState === "verified" ? (
            <p className="decave-turnstile-recovery-copy verified">Security check complete. You can continue.</p>
          ) : (
            <>
              <p className="decave-turnstile-recovery-copy">
                Cloudflare could not finish in the background. Complete the check here, then continue.
              </p>
              <button
                type="button"
                className="decave-turnstile-retry"
                onClick={() => {
                  onToken("");
                  setRecoveryVisible(false);
                  setVerificationState("loading");
                  setRetryCount((value) => value + 1);
                }}
              >
                Retry security check
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
