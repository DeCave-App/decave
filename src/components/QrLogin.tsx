import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useTranslation } from "react-i18next";
import { serverErrorOr } from "../safety/server-error";

type QrLoginProps = {
  client: "web" | "desktop";
  onAuthenticated: (data: { user: unknown; wsToken: string; safety?: unknown }) => void;
};

export function QrLogin({ client, onAuthenticated }: QrLoginProps) {
  const { t } = useTranslation(["safety"]);
  const [image, setImage] = useState("");
  const [message, setMessage] = useState(() => t("safety.qrLogin.creating"));
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let stopped = false;
    let claimTimer = 0;
    let refreshTimer = 0;
    void (async () => {
      try {
        // The client kind is shown to the approving phone before it approves.
        const response = await fetch("/api/auth/qr/start", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client }),
        });
        const data = (await response.json()) as {
          challengeId?: string;
          secret?: string;
          payload?: string;
          error?: string;
          code?: string;
        };
        if (!response.ok || !data.challengeId || !data.secret || !data.payload)
          throw new Error(serverErrorOr(data, t("safety.qrLogin.createFailed")));
        const dataUrl = await QRCode.toDataURL(data.payload, {
          width: 150,
          margin: 2,
          color: { dark: "#07101f", light: "#ffffff" },
          errorCorrectionLevel: "M",
        });
        if (stopped) return;
        setImage(dataUrl);
        setMessage(t("safety.qrLogin.instructions"));
        refreshTimer = window.setTimeout(() => {
          if (!stopped) {
            setImage("");
            setMessage(t("safety.qrLogin.updating"));
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
              code?: string;
            };
            if (claimResponse.ok && claimData.user && claimData.wsToken) {
              onAuthenticated({ user: claimData.user, wsToken: claimData.wsToken, safety: claimData.safety });
              return;
            }
            if (claimResponse.status === 202) {
              claimTimer = window.setTimeout(claim, 1400);
              return;
            }
            throw new Error(serverErrorOr(claimData, t("safety.qrLogin.expired")));
          } catch (cause) {
            if (!stopped) setMessage(cause instanceof Error ? cause.message : t("safety.qrLogin.expired"));
          }
        };
        claimTimer = window.setTimeout(claim, 1000);
      } catch (cause) {
        if (!stopped) setMessage(cause instanceof Error ? cause.message : t("safety.qrLogin.createFailed"));
      }
    })();
    return () => {
      stopped = true;
      window.clearTimeout(claimTimer);
      window.clearTimeout(refreshTimer);
    };
  }, [client, nonce]);

  return (
    <div className="dc-qr-login" title={message}>
      {image ? (
        <img className="dc-qr-login-code" src={image} alt={t("safety.qrLogin.codeAlt")} width={88} height={88} />
      ) : (
        <div className="dc-qr-login-code is-pending">{t("safety.qrLogin.preparing")}</div>
      )}
      <small>{t("safety.qrLogin.scan")}</small>
    </div>
  );
}
