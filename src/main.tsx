import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/design-system.css";
import App from "./App";
import { I18nProvider } from "./i18n/I18nProvider";
import { i18next } from "./i18n";
import { followLocaleOnDesktop } from "./app/desktop";

class AppErrorBoundary extends React.Component<React.PropsWithChildren, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("DeCave failed to render", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "24px",
          background: "var(--ds-surface-2)",
          color: "var(--ds-text)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <section
          style={{
            width: "min(680px, 100%)",
            padding: "24px",
            border: "1px solid color-mix(in srgb, var(--ds-danger) 42%, transparent)",
            borderRadius: "16px",
            background: "var(--ds-surface-2)",
            boxShadow: "0 20px 60px rgba(0,0,0,.35)",
          }}
        >
          <h1 style={{ margin: "0 0 8px", fontSize: "20px" }}>{i18next.t("common.app.renderFailedTitle")}</h1>
          <p style={{ margin: "0 0 16px", color: "var(--ds-text-soft)" }}>{i18next.t("common.app.renderFailedBody")}</p>
          <pre
            style={{
              maxHeight: "240px",
              overflow: "auto",
              padding: "12px",
              borderRadius: "10px",
              background: "var(--ds-surface-2)",
              color: "var(--ds-danger)",
              whiteSpace: "pre-wrap",
            }}
          >
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              minHeight: "38px",
              padding: "0 14px",
              border: 0,
              borderRadius: "9px",
              background: "var(--ds-accent)",
              color: "var(--ds-on-accent)",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            {i18next.t("common.app.reload")}
          </button>
        </section>
      </main>
    );
  }
}

followLocaleOnDesktop();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <I18nProvider>
        <App />
      </I18nProvider>
    </AppErrorBoundary>
  </React.StrictMode>,
);
