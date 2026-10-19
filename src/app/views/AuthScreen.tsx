// Sign-in, registration, password recovery and second-factor screen shown before login.

import { Trans, useTranslation } from "react-i18next";
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

const TERMS_URL = "https://de-cave.com/terms";
const PRIVACY_URL = "https://de-cave.com/privacy";

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
  const { t } = useTranslation(["common", "hub", "chat"]);
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
            <div className="vadrion-auth-tagline">{t("common.auth.tagline")}</div>
            <p>{t("common.auth.heroBody")}</p>
          </div>
          <div className="vadrion-feature-row">
            <span>{t("common.auth.featureVoice")}</span>
            <span>{t("common.auth.featureHubs")}</span>
            <span>{t("common.auth.featureRooms")}</span>
            <span>{t("common.auth.featureCommunity")}</span>
          </div>
        </section>

        <section className="username-card vadrion-auth-card">
          <div className="vadrion-auth-card-kicker">
            {authMode === "login"
              ? t("common.auth.kickerLogin")
              : authMode === "register"
                ? t("common.auth.kickerRegister")
                : t("common.auth.kickerRecovery")}
          </div>
          <div className="dc-auth-card-head">
            <div className="dc-auth-card-title">
              <h1>
                {ownerLoginChallengeToken
                  ? loginMfaKind === "user"
                    ? t("common.auth.titleTwoFactor")
                    : t("common.auth.titleOwner")
                  : authMode === "login"
                    ? t("common.auth.titleLogin")
                    : authMode === "register"
                      ? t("common.auth.titleRegister")
                      : t("common.auth.titleForgot")}
              </h1>
              <p>
                {ownerLoginChallengeToken
                  ? loginMfaKind === "user"
                    ? t("common.auth.leadTwoFactor")
                    : t("common.auth.leadOwner")
                  : authMode === "login"
                    ? t("common.auth.leadLogin")
                    : authMode === "register"
                      ? t("common.auth.leadRegister")
                      : t("common.auth.leadForgot")}
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
                placeholder={t("common.account.mfaCodeLabel")}
                autoComplete="one-time-code"
                autoFocus
              />
              <button
                type="button"
                onClick={() => void submitOwnerMfaLogin()}
                disabled={ownerLoginMfaBusy || !ownerLoginMfaCode.trim()}
              >
                {ownerLoginMfaBusy ? t("common.auth.verifying") : t("common.auth.verifyEnter")}
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
                {t("common.auth.cancelSignIn")}
              </button>
            </div>
          )}

          {!ownerLoginChallengeToken && (
            <form
              style={{ display: "contents" }}
              onSubmit={(event) => {
                event.preventDefault();
                void submitAuth();
              }}
            >
              {authMode === "register" && (
                <input
                  type="email"
                  placeholder={t("common.auth.email")}
                  value={emailInput}
                  onChange={(event) => setEmailInput(event.target.value)}
                  autoComplete="email"
                  maxLength={254}
                />
              )}

              {authMode === "forgot" ? (
                <input
                  type="email"
                  placeholder={t("common.auth.verifiedEmail")}
                  value={emailInput}
                  onChange={(event) => setEmailInput(event.target.value)}
                  autoComplete="email"
                  autoFocus
                  maxLength={254}
                />
              ) : (
                <input
                  type={authMode === "login" ? "email" : "text"}
                  placeholder={authMode === "login" ? t("common.auth.email") : t("common.auth.username")}
                  value={usernameInput}
                  onChange={(event) => setUsernameInput(event.target.value)}
                  autoComplete="username"
                  autoFocus={authMode !== "register"}
                  maxLength={authMode === "login" ? 254 : 24}
                  style={authMode === "register" ? { marginTop: "12px" } : undefined}
                />
              )}

              {authMode === "register" && (
                <label className="dc-auth-age-field">
                  <span>{t("common.ageGate.birthDate")}</span>
                  <input
                    type="date"
                    value={birthDateInput}
                    onChange={(event) => setBirthDateInput(event.target.value)}
                    autoComplete="bday"
                    max={new Date().toISOString().slice(0, 10)}
                  />
                  <small>{t("common.auth.birthDateHint", { age: MINIMUM_SIGNUP_AGE })}</small>
                </label>
              )}

              {authMode !== "forgot" && (
                <input
                  type="password"
                  placeholder={t("common.auth.password")}
                  value={passwordInput}
                  onChange={(event) => setPasswordInput(event.target.value)}
                  autoComplete={authMode === "login" ? "current-password" : "new-password"}
                  maxLength={128}
                  minLength={authMode === "register" ? 10 : undefined}
                  style={{ marginTop: "12px" }}
                />
              )}

              {authMode === "register" && (
                <input
                  type="password"
                  placeholder={t("common.auth.confirmPassword")}
                  value={confirmPasswordInput}
                  onChange={(event) => setConfirmPasswordInput(event.target.value)}
                  autoComplete="new-password"
                  maxLength={128}
                  style={{ marginTop: "12px" }}
                />
              )}

              {authMode === "register" && (
                <label className="dc-auth-consent">
                  <input
                    type="checkbox"
                    checked={termsAccepted}
                    onChange={(event) => setTermsAccepted(event.target.checked)}
                  />
                  <span>
                    <Trans
                      t={t}
                      i18nKey="common.auth.consent"
                      values={{ age: MINIMUM_SIGNUP_AGE }}
                      components={[
                        <a key="terms" href={TERMS_URL} target="_blank" rel="noreferrer" />,
                        <a key="privacy" href={PRIVACY_URL} target="_blank" rel="noreferrer" />,
                      ]}
                    />
                  </span>
                </label>
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
                  <span>{t("common.auth.staySignedIn")}</span>
                </label>
              )}

              {turnstileTestMode ? (
                <div className="decave-turnstile-shell recovery" role="status">
                  <div className="decave-turnstile-meta">
                    <span>{t("common.auth.localCheck")}</span>
                    <strong>{t("common.auth.ready")}</strong>
                  </div>
                  <p className="decave-turnstile-recovery-copy verified">{t("common.auth.localCheckBody")}</p>
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
                <p style={authErrorStyle}>{t("common.auth.turnstileMissing")}</p>
              )}

              {authError && <p style={authErrorStyle}>{authError}</p>}

              <button
                type="submit"
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
                  ? t("common.auth.pleaseWait")
                  : authMode === "login"
                    ? t("common.auth.submitLogin")
                    : authMode === "register"
                      ? t("common.auth.submitRegister")
                      : t("common.auth.submitForgot")}
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
                  {t("common.auth.forgot")}
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setAuthMode(authMode === "register" ? "login" : authMode === "forgot" ? "login" : "register");
                  setAuthError("");
                  setConfirmPasswordInput("");
                  setBirthDateInput("");
                  setTermsAccepted(false);
                  setTurnstileToken("");
                  setTurnstileNonce((value) => value + 1);
                }}
                disabled={authBusy}
                style={authSwitchStyle}
              >
                {authMode === "login" ? t("common.auth.switchToRegister") : t("common.auth.backToLogin")}
              </button>

              <p className="dc-auth-legal">
                <Trans
                  t={t}
                  i18nKey="common.auth.legal"
                  components={[
                    <a key="terms" href={TERMS_URL} target="_blank" rel="noreferrer" />,
                    <a key="privacy" href={PRIVACY_URL} target="_blank" rel="noreferrer" />,
                  ]}
                />
              </p>
            </form>
          )}

          <div className="vadrion-auth-skins">
            <div className="vadrion-mini-label">{t("common.auth.chooseVibe")}</div>
            <div className="vadrion-skin-row" style={{ flexWrap: "wrap" }}>
              <button
                type="button"
                className={appSkin === "nebula" ? "skin-chip active" : "skin-chip"}
                onClick={() => chooseAppSkin("nebula")}
              >
                <span className="skin-swatch nebula" />
                {t("common.skins.nebula")}
              </button>
              <button
                type="button"
                className={appSkin === "arctic" ? "skin-chip active" : "skin-chip"}
                onClick={() => chooseAppSkin("arctic")}
              >
                <span className="skin-swatch arctic" />
                {t("common.skins.arctic")}
              </button>
              <button
                type="button"
                className={appSkin === "crimson" ? "skin-chip active" : "skin-chip"}
                onClick={() => chooseAppSkin("crimson")}
              >
                <span className="skin-swatch crimson" />
                {t("common.skins.crimson")}
              </button>
              <button
                type="button"
                className={appSkin === "royal" ? "skin-chip active" : "skin-chip"}
                onClick={() => chooseAppSkin("royal")}
              >
                <span className="skin-swatch royal" />
                {t("common.skins.royal")}
              </button>
              <button
                type="button"
                className={appSkin === "pearl" ? "skin-chip active" : "skin-chip"}
                onClick={() => chooseAppSkin("pearl")}
              >
                <span className="skin-swatch pearl" />
                {t("common.skins.pearl")}
              </button>
              <button
                type="button"
                className={appSkin === "obsidian" ? "skin-chip active" : "skin-chip"}
                onClick={() => chooseAppSkin("obsidian")}
              >
                <span className="skin-swatch obsidian" />
                {t("common.skins.obsidian")}
              </button>
              <button
                type="button"
                className={appSkin === "verdant" ? "skin-chip active" : "skin-chip"}
                onClick={() => chooseAppSkin("verdant")}
              >
                <span className="skin-swatch verdant" />
                {t("common.skins.verdant")}
              </button>
              <button
                type="button"
                className={appSkin === "bright" ? "skin-chip active" : "skin-chip"}
                onClick={() => chooseAppSkin("bright")}
              >
                <span className="skin-swatch bright" />
                {t("common.skins.bright")}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
