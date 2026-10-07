import decaveMark from "../../assets/decave-mark-reference.png";

export function DeCaveBrand({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={compact ? "vadrion-brand compact" : "vadrion-brand"}
      style={{
        display: "inline-flex",
        flexDirection: "row",
        flexWrap: "nowrap",
        alignItems: "center",
        justifyContent: "flex-start",
        gap: compact ? "8px" : "16px",
        width: "auto",
        maxWidth: "100%",
        background: "transparent",
        border: 0,
        boxShadow: "none",
        filter: "none",
      }}
    >
      <img
        className="vadrion-brand-mark"
        src={decaveMark}
        alt=""
        aria-hidden="true"
        draggable={false}
        width={compact ? 40 : 96}
        height={compact ? 40 : 96}
        style={{
          width: compact ? "40px" : "96px",
          height: compact ? "40px" : "96px",
          flex: "0 0 auto",
          display: "block",
          objectFit: "contain",
          objectPosition: "center",
          background: "transparent",
          border: 0,
          boxShadow: "none",
          imageRendering: "auto",
        }}
      />
      {!compact && (
        <span
          aria-label="DeCave"
          style={{
            display: "inline-flex",
            flex: "0 0 auto",
            alignItems: "baseline",
            fontSize: "36px",
            lineHeight: 1,
            fontWeight: 800,
            letterSpacing: "-0.055em",
            whiteSpace: "nowrap",
            textShadow: "none",
          }}
        >
          <span style={{ color: "var(--ds-text)" }}>De</span>
          <span
            style={{
              background: "linear-gradient(180deg, #667cff 0%, #6b57ff 45%, #8a49ff 100%)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            C
          </span>
          <span style={{ color: "var(--ds-text)" }}>ave</span>
        </span>
      )}
    </div>
  );
}
