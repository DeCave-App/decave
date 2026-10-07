// Sign-in, registration, password recovery and second-factor screen shown before login.

import type { Dispatch, SetStateAction } from "react";
import type { SafetyProfile } from "../../safety/types";
import { QrLogin } from "../../components/QrLogin";
import type { AccountUser, AppSkin } from "../types";
import { hasDesktopActivityBridge } from "../desktop";
import { DeCaveBrand } from "../components/DeCaveBrand";
import { TurnstileWidget } from "../components/TurnstileWidget";
import { authErrorStyle, authSwitchStyle } from "../inline-styles";
import type { AuthFormState } from "../state/auth-form";
import { MINIMUM_SIGNUP_AGE } from "../../../shared/legal-consent";

type Props = {
  setCurrentUser: Dispatch<SetStateAction<AccountUser | null>>;
  setAuthReady: Dispatch<SetStateAction<boolean>>;
  authMode: "login" | "register" | "forgot";
  setAuthMode: Dispatch<SetStateAction<"login" | "register" | "forgot">>;
  appSkin: AppSkin;
  displaySkin: AppSkin;
  turnstileSiteKey: string;
  turnstileTestMode: boolean;
  turnstileToken: string;
  setTurnstileToken: Dispatch<SetStateAction<string>>;
  turnstileNonce: number;
  setTurnstileNonce: Dispatch<SetStateAction<number>>;
  authError: string;
  setAuthError: Dispatch<SetStateAction<string>>;
  ownerLoginChallengeToken: string;
  setOwnerLoginChallengeToken: Dispatch<SetStateAction<string>>;
  ownerLoginMfaCode: string;
  setOwnerLoginMfaCode: Dispatch<SetStateAction<string>>;
  ownerLoginMfaBusy: boolean;
  submitOwnerMfaLogin: () => Promise<void>;
  chooseAppSkin: (skin: AppSkin) => void;
  storeToken: (token: string) => void;
  submitAuth: () => Promise<void>;
  authForm: AuthFormState;
};

export function AuthScreen({
  setCurrentUser,
  setAuthReady,
  authMode,
  setAuthMode,
  appSkin,
  displaySkin,
  turnstileSiteKey,
  turnstileTestMode,
  turnstileToken,
  setTurnstileToken,
  turnstileNonce,
  setTurnstileNonce,
  authError,
  setAuthError,
  ownerLoginChallengeToken,
  setOwnerLoginChallengeToken,
  ownerLoginMfaCode,
  setOwnerLoginMfaCode,
  ownerLoginMfaBusy,
  submitOwnerMfaLogin,
  chooseAppSkin,
  storeToken,
  submitAuth,
  authForm,
}: Props) {
  const {
    usernameInput,
    setUsernameInput,
    emailInput,
    setEmailInput,
    passwordInput,
    setPasswordInput,
    confirmPasswordInput,
    setConfirmPasswordInput,
    birthDateInput,
    setBirthDateInput,
    termsAccepted,
    setTermsAccepted,
    staySignedIn,
    setStaySignedIn,
    authBusy,
    loginMfaKind,
  } = authForm;
  return (
    <div className="username-screen vadrion-auth-screen" data-skin={displaySkin}>
      <div className="vadrion-auth-layout">
        <section className="vadrion-auth-hero">
          <div className="vadrion-auth-brand-wrap">
            <DeCaveBrand />
            <div className="vadrion-auth-tagline">Find your crew. Join the flow.</div>
            <p>Fast voice, focused communities, and rooms built around the way you play.</p>
          </div>
          <div className="vadrion-feature-row">
            <span>〽 Voice</span>
            <span>⬡ Hubs</span>
            <span>▱ Rooms</span>
            <span>◎ Community</span>
          </div>
        </section>

        <section className="username-card vadrion-auth-card">
          <div className="vadrion-auth-card-kicker">
            {authMode === "login" ? "WELCOME BACK" : authMode === "register" ? "JOIN DECAVE" : "ACCOUNT RECOVERY"}
          </div>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1>
                {ownerLoginChallengeToken
                  ? loginMfaKind === "user"
                    ? "Two-factor check"
                    : "Verify owner access"
                  : authMode === "login"
                    ? "Enter your space"
                    : authMode === "register"
                      ? "Create your account"
                      : "Reset your password"}
              </h1>
              <p>
                {ownerLoginChallengeToken
                  ? loginMfaKind === "user"
                    ? "Enter the 6-digit code from your authenticator app, or one of your recovery codes."
                    : "This platform-owner account requires a second factor."
                  : authMode === "login"
                    ? "Log in with your email address."
                    : authMode === "register"
                      ? "Create an account with a verified email and public username."
                      : "Enter your verified email and we'll send you a short-lived reset link."}
              </p>
            </div>
            {!ownerLoginChallengeToken && authMode === "login" && (
              <QrLogin
                client={hasDesktopActivityBridge() ? "desktop" : "web"}
                onAuthenticated={(data) => {
                  storeToken(data.wsToken);
                  setCurrentUser({ ...(data.user as AccountUser), safety: data.safety as SafetyProfile | undefined });
                  setAuthReady(true);
                  setAuthError("");
                }}
              />
            )}
          </div>

          {ownerLoginChallengeToken && (
            <div
              style={{
                display: "grid",
                gap: "10px",
                marginTop: "12px",
                padding: "14px",
                borderRadius: "12px",
                border: "1px solid color-mix(in srgb, var(--ds-accent-2) 24%, transparent)",
                background: "var(--ds-surface-2)",
              }}
            >
              <input
                type="text"
                value={ownerLoginMfaCode}
                onChange={(event) =>
                  setOwnerLoginMfaCode(event.target.value.toUpperCase().replace(/\s/g, "").slice(0, 19))
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") void submitOwnerMfaLogin();
                }}
                placeholder="Authenticator or recovery code"
                autoComplete="one-time-code"
                autoFocus
              />
              <button
                type="button"
                onClick={() => void submitOwnerMfaLogin()}
                disabled={ownerLoginMfaBusy || !ownerLoginMfaCode.trim()}
              >
                {ownerLoginMfaBusy ? "Verifying..." : "Verify & Enter DeCave"}
              </button>
              <button
                type="button"
                style={authSwitchStyle}
                onClick={() => {
                  setOwnerLoginChallengeToken("");
                  setOwnerLoginMfaCode("");
                  setAuthError("");
                  setTurnstileToken("");
                  setTurnstileNonce((value) => value + 1);
                }}
                disabled={ownerLoginMfaBusy}
              >
                {"Cancel and sign in again"}
              </button>
            </div>
          )}

          {!ownerLoginChallengeToken && (
            <>
              {authMode === "register" && (
                <input
                  type="email"
                  placeholder="Email"
                  value={emailInput}
                  onChange={(event) => setEmailInput(event.target.value)}
                  autoComplete="email"
                  maxLength={254}
                />
              )}

              {authMode === "forgot" ? (
                <input
                  type="email"
                  placeholder="Verified email"
                  value={emailInput}
                  onChange={(event) => setEmailInput(event.target.value)}
                  autoComplete="email"
                  autoFocus
                  maxLength={254}
                />
              ) : (
                <input
                  type={authMode === "login" ? "email" : "text"}
                  placeholder={authMode === "login" ? "Email" : "Username"}
                  value={usernameInput}
                  onChange={(event) => setUsernameInput(event.target.value)}
                  autoComplete={authMode === "login" ? "email" : "nickname"}
                  autoFocus={authMode !== "register"}
                  maxLength={authMode === "login" ? 254 : 24}
                  style={authMode === "register" ? { marginTop: "12px" } : undefined}
                />
              )}

              {authMode === "register" && (
                <label className="dc-auth-age-field">
                  <span>Birth date</span>
                  <input
                    type="date"
                    value={birthDateInput}
                    onChange={(event) => setBirthDateInput(event.target.value)}
                    autoComplete="bday"
                    max={new Date().toISOString().slice(0, 10)}
                  />
                  <small>
                    Used only to confirm that DeCave is available to people aged {MINIMUM_SIGNUP_AGE} or older. We do
                    not store the exact date.
                  </small>
                </label>
              )}

              {authMode !== "forgot" && (
                <input
                  type="password"
                  placeholder="Password"
                  value={passwordInput}
                  onChange={(event) => setPasswordInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void submitAuth();
                  }}
                  autoComplete={authMode === "login" ? "current-password" : "new-password"}
                  maxLength={128}
                  minLength={authMode === "register" ? 10 : undefined}
                  style={{ marginTop: "12px" }}
                />
              )}

              {authMode === "register" && (
                <label
                  style={{
                    marginTop: "12px",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "9px",
                    color: "var(--ds-text-soft)",
                    fontSize: "12px",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={termsAccepted}
                    onChange={(event) => setTermsAccepted(event.target.checked)}
                    aria-label="I agree to Terms and acknowledge Privacy Notice"
                    style={{ width: "16px", height: "16px", margin: 0, accentColor: "#6d63ff" }}
                  />
                  <span>
                    I agree to{" "}
                    <a href="https://de-cave.com/terms" target="_blank" rel="noopener noreferrer">
                      Terms
                    </a>{" "}
                    and acknowledge{" "}
                    <a href="https://de-cave.com/privacy" target="_blank" rel="noopener noreferrer">
                      Privacy Notice
                    </a>
                  </span>
                </label>
              )}

              {authMode === "register" && (
                <input
                  type="password"
                  placeholder="Confirm password"
                  value={confirmPasswordInput}
                  onChange={(event) => setConfirmPasswordInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void submitAuth();
                  }}
                  autoComplete="new-password"
                  maxLength={128}
                  style={{ marginTop: "12px" }}
                />
              )}

              {authMode === "login" && (
                <label
                  style={{
                    marginTop: "12px",
                    display: "flex",
                    alignItems: "center",
                    gap: "9px",
                    color: "var(--ds-text-soft)",
                    fontSize: "12px",
                    cursor: "pointer",
                    userSelect: "none",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={staySignedIn}
                    onChange={(event) => setStaySignedIn(event.target.checked)}
                    style={{
                      width: "16px",
                      height: "16px",
                      margin: 0,
                      accentColor: "#6d63ff",
                    }}
                  />
                  <span>Stay signed in on this device</span>
                </label>
              )}

              {turnstileTestMode ? (
                <div className="decave-turnstile-shell recovery" role="status">
                  <div className="decave-turnstile-meta">
                    <span>LOCAL SECURITY CHECK</span>
                    <strong>Ready</strong>
                  </div>
                  <p className="decave-turnstile-recovery-copy verified">Local Worker test verification is enabled.</p>
                </div>
              ) : turnstileSiteKey ? (
                <TurnstileWidget
                  key={`${authMode}-${turnstileNonce}`}
                  siteKey={turnstileSiteKey}
                  action={authMode}
                  nonce={turnstileNonce}
                  onToken={setTurnstileToken}
                />
              ) : (
                <p style={authErrorStyle}>Security verification is not configured yet.</p>
              )}

              {authError && <p style={authErrorStyle}>{authError}</p>}

              <button
                type="button"
                onClick={() => void submitAuth()}
                disabled={
                  authBusy ||
                  !turnstileToken ||
                  (authMode === "forgot"
                    ? !emailInput.trim()
                    : !usernameInput.trim() ||
                      !passwordInput ||
                      (authMode === "register" &&
                        (!emailInput.trim() ||
                          !birthDateInput ||
                          !termsAccepted ||
                          passwordInput.length < 10 ||
                          !confirmPasswordInput ||
                          confirmPasswordInput !== passwordInput)))
                }
              >
                {authBusy
                  ? "Please wait..."
                  : authMode === "login"
                    ? "Enter DeCave"
                    : authMode === "register"
                      ? "Create Account"
                      : "Send Reset Link"}
              </button>

              {authMode === "login" && (
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode("forgot");
                    setAuthError("");
                    setTurnstileToken("");
                    setTurnstileNonce((value) => value + 1);
                  }}
                  disabled={authBusy}
                  style={authSwitchStyle}
                >
                  Forgot password?
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setAuthMode(authMode === "register" ? "login" : authMode === "forgot" ? "login" : "register");
                  setAuthError("");
                  setConfirmPasswordInput("");
                  setBirthDateInput("");
                  setTurnstileToken("");
                  setTurnstileNonce((value) => value + 1);
                }}
                disabled={authBusy}
                style={authSwitchStyle}
              >
                {authMode === "login" ? "New to DeCave? Create an account" : "Back to login"}
              </button>
            </>
          )}

          <div className="vadrion-auth-skins">
            <div className="vadrion-mini-label">CHOOSE YOUR VIBE</div>
            <div className="vadrion-skin-row" style={{ flexWrap: "wrap" }}>
              <button
                type="button"
                className={appSkin === "nebula" ? "skin-chip active" : "skin-chip"}
                onClick={() => chooseAppSkin("nebula")}
              >
                <span className="skin-swatch nebula" />
                Nebula Pulse
              </button>
              <button
                type="button"
                className={appSkin === "arctic" ? "skin-chip active" : "skin-chip"}
                onClick={() => chooseAppSkin("arctic")}
              >
                <span className="skin-swatch arctic" />
                Arctic Flux
              </button>
              <button
                type="button"
                className={appSkin === "crimson" ? "skin-chip active" : "skin-chip"}
                onClick={() => chooseAppSkin("crimson")}
              >
                <span className="skin-swatch crimson" />
                Crimson Glass
              </button>
              <button
                type="button"
                className={appSkin === "royal" ? "skin-chip active" : "skin-chip"}
                onClick={() => chooseAppSkin("royal")}
              >
                <span className="skin-swatch royal" />
                Royal Violet
              </button>
              <button
                type="button"
                className={appSkin === "pearl" ? "skin-chip active" : "skin-chip"}
                onClick={() => chooseAppSkin("pearl")}
              >
                <span className="skin-swatch pearl" />
                Pearl Glass
              </button>
              <button
                type="button"
                className={appSkin === "obsidian" ? "skin-chip active" : "skin-chip"}
                onClick={() => chooseAppSkin("obsidian")}
              >
                <span className="skin-swatch obsidian" />
                Obsidian Glass
              </button>
              <button
                type="button"
                className={appSkin === "verdant" ? "skin-chip active" : "skin-chip"}
                onClick={() => chooseAppSkin("verdant")}
              >
                <span className="skin-swatch verdant" />
                Verdant Raid
              </button>
              <button
                type="button"
                className={appSkin === "bright" ? "skin-chip active" : "skin-chip"}
                onClick={() => chooseAppSkin("bright")}
              >
                <span className="skin-swatch bright" />
                Bright Grey
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
