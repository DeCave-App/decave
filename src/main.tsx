import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/design-system.css";
import App from "./App";

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
          <h1 style={{ margin: "0 0 8px", fontSize: "20px" }}>DeCave could not render</h1>
          <p style={{ margin: "0 0 16px", color: "var(--ds-text-soft)" }}>
            The local app hit a runtime error before the interface loaded.
          </p>
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
            Reload app
          </button>
        </section>
      </main>
    );
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
