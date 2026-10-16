// The "Saved · Undo" toast at the bottom of Settings. One at a time; each new
// message replaces the last and stays for three seconds.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSettingsT } from "./useSettingsT";

export const SETTINGS_TOAST_MS = 3000;

type Toast = { id: number; messageKey: string; undo?: () => void };

type ToastApi = { show(messageKey: string, undo?: () => void): void };

const ToastContext = createContext<ToastApi>({ show: () => undefined });

export function useSettingsToast(): ToastApi {
  return useContext(ToastContext);
}

export function SettingsToastProvider({ children }: { children: ReactNode }) {
  const { t, tk } = useSettingsT();
  const [toast, setToast] = useState<Toast | null>(null);
  const nextId = useRef(0);

  const show = useCallback((messageKey: string, undo?: () => void) => {
    nextId.current += 1;
    setToast({ id: nextId.current, messageKey, undo });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(
      () => setToast((current) => (current?.id === toast.id ? null : current)),
      SETTINGS_TOAST_MS,
    );
    return () => window.clearTimeout(timer);
  }, [toast]);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="dcs-toast-region" role="status" aria-live="polite">
        {toast && (
          <div className="dcs-toast" key={toast.id}>
            <span>{tk(toast.messageKey)}</span>
            {toast.undo && (
              <button
                type="button"
                className="dcx-btn dcx-btn-ghost dcx-btn-sm"
                onClick={() => {
                  const undo = toast.undo;
                  setToast(null);
                  undo?.();
                }}
              >
                {t("settings.toast.undo")}
              </button>
            )}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
