// Inline styles used by App.tsx.

import type { CSSProperties } from "react";

export const profileSettingsRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "16px",
};

export const profileSettingsAvatarStyle: CSSProperties = {
  width: "82px",
  height: "82px",
  flex: "0 0 82px",
  borderRadius: "24px",
  background: "linear-gradient(135deg, #7c6cff, #4f8cff)",
  color: "#ffffff",
  fontSize: "30px",
  fontWeight: 900,
};

export const profileButtonRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  flexWrap: "wrap",
  marginTop: "12px",
};

export const profileUploadButtonStyle: CSSProperties = {
  minHeight: "38px",
  padding: "0 14px",
  borderRadius: "10px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  background: "linear-gradient(135deg, #7c6cff, #4f8cff)",
  color: "#ffffff",
  fontWeight: 800,
  cursor: "pointer",
};

export const profileRemoveButtonStyle: CSSProperties = {
  minHeight: "38px",
  padding: "0 14px",
  borderRadius: "10px",
};

export const voiceStageStyle: CSSProperties = {
  height: "100%",
  minHeight: 0,
  boxSizing: "border-box",
  padding: "20px",
  display: "flex",
  flexDirection: "column",
  gap: "18px",
};

export const screenGridStyle: CSSProperties = {
  display: "grid",
  width: "100%",
  minWidth: 0,
  minHeight: 0,
  flex: "1 1 0",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(520px, 100%), 1fr))",
  gridAutoRows: "minmax(0, 1fr)",
  alignItems: "stretch",
  gap: "14px",
};

export const screenCardStyle: CSSProperties = {
  background: "#111214",
  border: "1px solid #3f4147",
  borderRadius: "10px",
  overflow: "hidden",
  width: "100%",
  height: "100%",
  minWidth: 0,
};

export const screenLabelStyle: CSSProperties = {
  padding: "8px 10px",
  color: "#dbdee1",
  fontSize: "12px",
  fontWeight: 700,
  background: "#1e1f22",
};

export const screenVideoStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  display: "block",
  background: "#000000",
  objectFit: "contain",
};

export const voiceParticipantGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(245px, 1fr))",
  flex: "0 0 auto",
  minHeight: 0,
  maxHeight: "min(180px, 24vh)",
  overflow: "auto",
  gap: "10px",
};

export const voiceParticipantCardStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  padding: "10px",
  borderRadius: "8px",
  background: "#2b2d31",
};

export const voiceParticipantAvatarStyle: CSSProperties = {
  width: "36px",
  height: "36px",
  borderRadius: "50%",
  background: "#5865f2",
  display: "grid",
  placeItems: "center",
  fontWeight: 800,
  flex: "0 0 auto",
};

export const voiceControlBarStyle: CSSProperties = {
  minHeight: "74px",
  padding: "10px 16px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "14px",
};

export const voiceButtonRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  flexWrap: "wrap",
  justifyContent: "flex-end",
};

export const voiceActionButtonStyle: CSSProperties = {
  minWidth: "82px",
  height: "38px",
  borderRadius: "var(--ds-radius-md)",
  background: "var(--ds-surface-3)",
  color: "var(--ds-text)",
  fontWeight: 600,
};

export const voiceShareButtonStyle: CSSProperties = {
  ...voiceActionButtonStyle,
  background: "var(--ds-accent)",
  color: "var(--ds-on-accent)",
  minWidth: "112px",
};

export const voiceStopShareButtonStyle: CSSProperties = {
  ...voiceActionButtonStyle,
  background: "var(--ds-danger)",
  color: "var(--ds-on-accent)",
  minWidth: "112px",
};

export const voiceDisconnectButtonStyle: CSSProperties = {
  ...voiceActionButtonStyle,
  background: "var(--ds-danger)",
  color: "var(--ds-on-accent)",
  minWidth: "100px",
};

export const discoverServerCardStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  padding: "12px",
  borderRadius: "8px",
  background: "#2b2d31",
  border: "1px solid #3f4147",
};

export const discoverServerIconStyle: CSSProperties = {
  width: "44px",
  height: "44px",
  borderRadius: "14px",
  display: "grid",
  placeItems: "center",
  background: "#5865f2",
  color: "#ffffff",
  fontWeight: 800,
  flexShrink: 0,
};

export const errorTextStyle: CSSProperties = {
  color: "#ed4245",
  marginTop: "10px",
  marginBottom: "0",
};

export const authErrorStyle: CSSProperties = {
  ...errorTextStyle,
  textAlign: "left",
};

export const authSwitchStyle: CSSProperties = {
  background: "transparent",
  color: "#b5bac1",
  marginTop: "8px",
};

export const selectStyle: CSSProperties = {
  width: "100%",
  height: "44px",
  marginTop: "12px",
  padding: "0 12px",
  border: "1px solid #1e1f22",
  borderRadius: "6px",
  outline: "none",
  background: "#1e1f22",
  color: "#ffffff",
};

export const memberMutedStyle: CSSProperties = {
  color: "#949ba4",
  fontSize: "11px",
};

export const settingsSectionStyle: CSSProperties = {
  marginTop: "12px",
  padding: "16px",
  borderRadius: "14px",
  border: "1px solid rgba(125, 146, 184, 0.16)",
  background: "linear-gradient(145deg, rgba(18, 26, 45, .72), rgba(8, 14, 25, .68))",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,.025)",
};

export const settingsSectionTitleStyle: CSSProperties = {
  marginBottom: "14px",
  color: "#949ba4",
  fontSize: "11px",
  fontWeight: 800,
  letterSpacing: "0.04em",
};

export const settingsLabelStyle: CSSProperties = {
  display: "grid",
  gap: "7px",
  marginBottom: "14px",
  color: "#dbdee1",
  fontSize: "12px",
  fontWeight: 700,
};

export const audioErrorStyle: CSSProperties = {
  marginTop: "10px",
  padding: "9px 10px",
  borderRadius: "6px",
  background: "#4b2426",
  color: "#ffb3b5",
  fontSize: "12px",
};
