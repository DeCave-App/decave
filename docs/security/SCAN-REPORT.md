# Security scan report

Scanned 2026-10-12, release 0.1.149.

## Summary

We ran free, widely used open-source scanners over the full DeCave codebase (web app, Cloudflare Worker backend, Electron desktop app, mobile app) and the complete git history. **No exploitable vulnerabilities or leaked secrets were found.** Every result the tools flagged was reviewed by hand; the details are below so you can check our reasoning.

| Scanner | What it checks | Result |
| --- | --- | --- |
| npm audit | Known vulnerabilities in third-party packages | 0 issues |
| OSV-Scanner 2.2.2 | Known vulnerabilities across all lockfiles (OSV/NVD data) | 1 match, a false positive (see below) |
| Gitleaks | API keys, tokens, passwords in code and git history | 0 real secrets |
| Semgrep 1.180.0 | Insecure code patterns (TypeScript, JavaScript, React, secrets rules) | 0 real issues |
| Electronegativity 1.10.3 | Electron desktop app misconfigurations | 0 real issues |
| Trivy | Dependencies and config files (high and critical) | 0 issues |

## Update: this public repository was refreshed

A community member pointed out 55+ dependency vulnerabilities in this public repository. They were right: it was a stale snapshot of release 0.1.132 whose lockfiles predated our dependency patches. OSV-Scanner found **106 known vulnerabilities (73 high/critical)** in that snapshot.

It is now synced to release 0.1.149, and the release process republishes it on every release so it no longer goes stale.

| This repository | Known dependency vulns (OSV) | High / critical |
| --- | --- | --- |
| Before (0.1.132) | 106 | 73 |
| After (0.1.149) | 1 (false positive) | 0 |

## Dependencies

`npm audit` on the main app, the mobile app and the website reports **0 known vulnerabilities** in all three.

OSV-Scanner reports one match: `decode-uri-component@0.5.0-gamerchat.1` (GHSA-vcc3-ghjq-m6fr). This is our own patched copy in [`vendor/`](../../vendor/README.md) that already contains the fix for that exact advisory, with a regression test. Scanners that only compare version strings cannot tell it is patched. We patched `braces`, `node-forge` and `sprintf-js` the same way; see [`vendor/README.md`](../../vendor/README.md).

## Secrets

Gitleaks scanned every commit for credentials. The only matches are example strings in the vendored `node-forge` documentation and three constant *names* in our code (local-storage setting keys and an attachment-key variable), not secret values. Each is allowlisted by exact file and line in [`.gitleaks.toml`](../../.gitleaks.toml). Real deployment secrets are kept out of the repository and were never committed.

## Code patterns

Semgrep raised one warning about the `X-Frame-Options` header in the Worker's security-headers function. The server already sends a strict configuration: `X-Frame-Options: DENY`, a Content-Security-Policy with `frame-ancestors 'none'`, HSTS, `nosniff` and a locked-down Permissions-Policy. Not an issue.

## Desktop app

Electronegativity raised three "global" warnings: no Content-Security-Policy, no navigation limits, and no permission request handler. All three protections are in place:

- Every window runs with `sandbox: true`, `contextIsolation: true` and `nodeIntegration: false`.
- New windows are denied via `setWindowOpenHandler`, and `will-navigate` guards block unexpected navigation.
- Permission check and request handlers restrict which permissions each origin can get.
- Pages carry a Content-Security-Policy.

The tool could not detect our Electron version and does not follow `.cjs` files, which is why it missed these.

## Ongoing scanning

Every push runs Gitleaks, Trivy and Semgrep in GitHub Actions ([`secret-scan.yml`](../../.github/workflows/secret-scan.yml), [`security-scan.yml`](../../.github/workflows/security-scan.yml)), with a weekly scheduled run so newly published advisories surface without a push. Dependabot security alerts are enabled.

## Limits

Automated scanners catch known-bad patterns, vulnerable dependencies and leaked secrets. They do not prove the end-to-end encryption design is correct; that needs a manual cryptography review or an independent audit, which has not yet been done. See [the encryption design](DM-E2EE.md).

## Reproduce it yourself

```sh
npm audit
osv-scanner scan source -r .
gitleaks git . --config .gitleaks.toml
semgrep scan --config p/typescript --config p/javascript --config p/secrets --config p/react
npx @doyensec/electronegativity -i electron
```
