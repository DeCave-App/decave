import { useEffect, useState } from "react";
import QRCode from "qrcode";

type QrLoginProps = {
  client: "web" | "desktop";
  onAuthenticated: (data: { user: unknown; wsToken: string; safety?: unknown }) => void;
};

export function QrLogin({ client, onAuthenticated }: QrLoginProps) {
  const [image, setImage] = useState("");
  const [message, setMessage] = useState("Creating a secure login code…");
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let stopped = false;
    let claimTimer = 0;
    let refreshTimer = 0;
    void (async () => {
      try {
        const response = await fetch("/api/auth/qr/start", { method: "POST", credentials: "include" });
        const data = (await response.json()) as {
          challengeId?: string;
          secret?: string;
          payload?: string;
          error?: string;
        };
        if (!response.ok || !data.challengeId || !data.secret || !data.payload)
          throw new Error(data.error || "Could not create QR login.");
        const dataUrl = await QRCode.toDataURL(data.payload, {
          width: 150,
          margin: 2,
          color: { dark: "#07101f", light: "#ffffff" },
          errorCorrectionLevel: "M",
        });
        if (stopped) return;
        setImage(dataUrl);
        setMessage("Open DeCave Mobile → Settings → Devices → Scan QR login.");
        refreshTimer = window.setTimeout(() => {
          if (!stopped) {
            setImage("");
            setMessage("Updating secure login code…");
            setNonce((value) => value + 1);
          }
        }, 105000);
        const claim = async () => {
          if (stopped) return;
          try {
            const claimResponse = await fetch("/api/auth/qr/claim", {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ challengeId: data.challengeId, secret: data.secret, client }),
            });
            const claimData = (await claimResponse.json()) as {
              pending?: boolean;
              user?: unknown;
              wsToken?: string;
              safety?: unknown;
              error?: string;
            };
            if (claimResponse.ok && claimData.user && claimData.wsToken) {
              onAuthenticated({ user: claimData.user, wsToken: claimData.wsToken, safety: claimData.safety });
              return;
            }
            if (claimResponse.status === 202) {
              claimTimer = window.setTimeout(claim, 1400);
              return;
            }
            throw new Error(claimData.error || "QR login expired.");
          } catch (cause) {
            if (!stopped) setMessage(cause instanceof Error ? cause.message : "QR login expired.");
          }
        };
        claimTimer = window.setTimeout(claim, 1000);
      } catch (cause) {
        if (!stopped) setMessage(cause instanceof Error ? cause.message : "Could not create QR login.");
      }
    })();
    return () => {
      stopped = true;
      window.clearTimeout(claimTimer);
      window.clearTimeout(refreshTimer);
    };
  }, [client, nonce]);

  return (
    <div
      title={message}
      style={{ flex: "0 0 150px", width: 150, display: "grid", justifyItems: "center", gap: 4, marginTop: 1 }}
    >
      {image ? (
        <img
          src={image}
          alt="DeCave QR login code"
          width={92}
          height={92}
          style={{
            display: "block",
            borderRadius: 8,
            background: "var(--ds-text)",
            padding: 4,
            boxSizing: "border-box",
          }}
        />
      ) : (
        <div
          style={{
            width: 92,
            height: 92,
            display: "grid",
            placeItems: "center",
            borderRadius: 8,
            background: "color-mix(in srgb, var(--ds-accent-2) 5%, transparent)",
            color: "var(--ds-accent-2)",
            fontSize: 8,
          }}
        >
          Preparing…
        </div>
      )}
      <small style={{ width: 98, color: "var(--ds-muted)", fontSize: 7, lineHeight: 1.25, textAlign: "center" }}>
        Log in using DeCave app
      </small>
    </div>
  );
}
