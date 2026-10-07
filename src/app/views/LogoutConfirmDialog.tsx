// Confirmation dialog shown before logging out.

import type { Dispatch, SetStateAction } from "react";

type Props = {
  setShowLogoutConfirm: Dispatch<SetStateAction<boolean>>;
  logout: () => Promise<void>;
};

export function LogoutConfirmDialog({ setShowLogoutConfirm, logout }: Props) {
  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setShowLogoutConfirm(false);
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 12000,
        display: "grid",
        placeItems: "center",
        padding: "20px",
        background: "var(--ds-surface-2)",
        backdropFilter: "blur(12px)",
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="decave-logout-confirm-title"
        style={{
          width: "min(430px, calc(100vw - 32px))",
          overflow: "hidden",
          border: "1px solid color-mix(in srgb, var(--ds-danger) 24%, transparent)",
          borderRadius: "18px",
          background: "linear-gradient(180deg, rgba(17, 23, 40, .99), rgba(8, 13, 26, .99))",
          boxShadow: "0 26px 90px rgba(0,0,0,.58), 0 0 0 1px rgba(255,255,255,.025) inset",
        }}
      >
        <div
          style={{
            padding: "22px 22px 18px",
            borderBottom: "1px solid color-mix(in srgb, var(--ds-border) 14%, transparent)",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "5px 9px",
              marginBottom: "12px",
              borderRadius: "999px",
              border: "1px solid color-mix(in srgb, var(--ds-danger) 18%, transparent)",
              background: "color-mix(in srgb, var(--ds-danger) 7%, transparent)",
              color: "var(--ds-danger)",
              fontSize: "10px",
              fontWeight: 900,
              letterSpacing: ".1em",
              textTransform: "uppercase",
            }}
          >
            Session
          </div>

          <h2
            id="decave-logout-confirm-title"
            style={{
              margin: 0,
              color: "var(--ds-text)",
              fontSize: "21px",
              lineHeight: 1.2,
            }}
          >
            Log out of DeCave?
          </h2>

          <p
            style={{
              margin: "9px 0 0",
              color: "var(--ds-muted)",
              fontSize: "13px",
              lineHeight: 1.55,
            }}
          >
            You will be signed out on this device. Your account, Hubs, Rooms, messages, and settings will stay intact.
          </p>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "10px",
            padding: "16px 18px 18px",
          }}
        >
          <button
            type="button"
            className="modal-secondary"
            autoFocus
            onClick={() => setShowLogoutConfirm(false)}
            style={{ minWidth: "96px" }}
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={() => void logout()}
            style={{
              minWidth: "110px",
              border: "1px solid color-mix(in srgb, var(--ds-danger) 30%, transparent)",
              borderRadius: "10px",
              padding: "10px 15px",
              background: "linear-gradient(135deg, rgba(222, 61, 101, .96), rgba(154, 44, 84, .96))",
              color: "var(--ds-text)",
              fontSize: "12px",
              fontWeight: 900,
              cursor: "pointer",
              boxShadow: "0 8px 24px rgba(199, 46, 91, .22)",
            }}
          >
            Log out
          </button>
        </div>
      </section>
    </div>
  );
}
