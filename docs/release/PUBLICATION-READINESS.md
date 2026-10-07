# Publication readiness

**Production release status: blocked.** The legal controller name, address, and countries of operation have not been supplied. Windows signing is not configured. No store-console privacy answers have been submitted. The user-authorized operator waiver for release `.129` is limited to that release; it does not satisfy or clear these legal and signing prerequisites, and the normal production publication gates remain in force. This checklist covers product policies, the public service, and shipped releases; it does not approve or prevent publication of a source-review repository.

The source-review repository is at `https://github.com/DeCave-App/decave`. A source-only public release would not approve the product policies, public service, or shipped releases covered by the production gates below.

## Required before publishing policies or a public service

1. Supply the real controller/contracting entity name, service address, and initial countries. Do not replace placeholders with a person or company that is not the actual controller.
2. Verify the deployed Cloudflare account, email delivery chain, Steam, Discord template lookup, GIPHY proxy, Expo Push/APNs/FCM, Expo EAS, and app-store configuration, contracts, roles, regions, transfer terms, and provider-side retention.
3. Review the source-backed Privacy Policy, Terms, and routing disclosure against those deployment facts. Confirm the applicable rights, age/parental-consent rules, complaint contacts, consumer terms, and any representative or officer obligations for each market.
4. Assign an operator for privacy requests, account export/erasure, legal holds, evidence deletion, R2 orphan inventory, security incidents, and regulator/user notices. Test each runbook and record actual provider behavior and response paths.
5. Review the iOS privacy manifest against the final compiled app and every included SDK. Complete App Store Connect and Google Play data-safety declarations from the shipped build and actual provider behavior; source declarations do not submit store disclosures.
6. (Advisory for now — `desktop:build` warns and builds unsigned with the unsigned-update opt-in; set `DECAVE_ENFORCE_WINDOWS_SIGNING=true` to require signing.) Obtain Windows code-signing credentials, set `DECAVE_WINDOWS_PUBLISHER` to the exact full Authenticode subject DN, and configure `CSC_LINK`/`WIN_CSC_LINK` or the installed-certificate equivalent. Build, inspect, and verify the signed installer and generated update configuration on Windows.
7. Complete security review and approve each policy version through the accountable release owner.

## Publication gate (advisory for now)

`npm run publication:check` (also invoked by website and release deployment/upload commands) currently only warns; set `DECAVE_ENFORCE_PUBLICATION_GATE=true` to make it blocking. When enforced it requires non-empty `DECAVE_LEGAL_ENTITY_NAME`, `DECAVE_CONTROLLER_ADDRESS`, and `DECAVE_SERVICE_COUNTRIES`, plus `DECAVE_PUBLICATION_APPROVED=true`. The same exact values must appear in the policy sources. The Privacy Policy, Terms, and website policy source must each contain a standalone `Publication status: Approved for publication` line and contain none of the recognized unresolved legal placeholders.

That environment flag is a release assertion, not a substitute for review or evidence. Do not set it until the accountable owner has checked the items above. Local development and builds remain available while publication is blocked.

## Current code behavior to disclose accurately

- New registrations require a self-attested age of at least 18. This is a conservative product rule pending selected countries, not a universal legal threshold; existing accounts are not retroactively required to re-confirm age.
- The app stores acceptance time and `2026-10` Terms/Privacy versions for new registrations.
- Hourly bounded cleanup expires credentials, removes security events and feedback after 365 days, and removes report evidence at explicit expiry or 365 days after creation by default. Evidence-level or case-level legal holds exclude it. Backlogged batches or failed queued R2 deletes can extend physical deletion time.
- `SECURITY_IP_HASH_KEY` is optional. With it, security-event IP fields store keyed HMAC-SHA-256 hashes; without it, a key derived from `OWNER_MFA_ENCRYPTION_KEY` is used, and only if neither secret is set are those fields empty. Edge and network providers may still process source IPs.
- Windows automatic updates require a trusted publisher configuration and valid matching Authenticode signatures by default. A release can opt into unsigned Windows updates only by shipping package metadata `decaveAllowUnsignedWindowsUpdates: true` with no publisher configured in `app-update.yml`. That opt-in retains electron-updater feed-hash integrity checks, but hashes do not authenticate the publisher. If a publisher is configured, signature verification remains strict even with the opt-in; unsigned updating is an artifact-specific exception, not the default or a substitute for signing readiness.

To enable the optional keyed IP tag in production, create a high-entropy secret and set it only in the Worker secret store with `npx wrangler secret put SECURITY_IP_HASH_KEY`. For local development, put it in the ignored `.dev.vars` file. Never put the value in `wrangler.jsonc`, source control, build logs, or a support report. If the secret is unset, the Worker falls back to a key derived from `OWNER_MFA_ENCRYPTION_KEY` and logs a warning; set a dedicated secret so the IP key can be rotated independently.

This document is an engineering checklist and is not itself a legal notice or operational approval.
