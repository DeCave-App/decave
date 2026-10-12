// Versions of the Terms of Service and Privacy Policy a new account must
// accept. Bump the matching version whenever docs/legal changes; sign-up then
// rejects clients that have not shown the current text. The mobile app keeps an
// identical copy (scripts/__tests__/legal-consent.test.mjs checks they match).

export const TERMS_VERSION = "2026-10-09";
export const PRIVACY_VERSION = "2026-10-09";

/** DeCave accounts are for adults only. */
export const MINIMUM_SIGNUP_AGE = 18;

export type LegalConsent = { termsAccepted: true; termsVersion: string; privacyVersion: string };

/** The consent fields a sign-up request sends once the box is ticked. */
export function currentLegalConsent(): LegalConsent {
  return { termsAccepted: true, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION };
}

/** True only when the request accepted exactly the current versions. */
export function acceptsCurrentLegalTerms(body: Record<string, unknown>): boolean {
  return body.termsAccepted === true && body.termsVersion === TERMS_VERSION && body.privacyVersion === PRIVACY_VERSION;
}
