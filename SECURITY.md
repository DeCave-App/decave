# Security Policy

DeCave is pre-release software. The latest source in this repository is the
only version maintainers can assess; no release support window or response
time is promised.

## Report a vulnerability

Use GitHub's private vulnerability reporting for this repository if it is
enabled. Otherwise, email **security@example.invalid**, the security contact listed
in the project source. If neither channel is available, open a minimal public
issue asking for a private reporting channel and do not include technical
details.

Please include a concise description, affected commit or version, the impact,
and safe steps to reproduce. Redact secrets, account details, IP addresses,
private messages, and any other personal or production data from logs and
screenshots. Do not access another person's account or data while investigating.
Please allow maintainers time to investigate and coordinate a fix before
publicly disclosing the issue.

There is no published bug bounty program or guaranteed response deadline.

## Review scope

The [project license](LICENSE) permits local code evaluation and security
reviews, including professional paid audits. It does not authorize testing
DeCave's hosted production systems, user accounts, data, or infrastructure.
Test only systems you own or have explicit permission to assess. Independent
review conclusions may be published without approval or a confidentiality
agreement; brief code excerpts may be included when reasonably needed to explain
the analysis. Please use the private reporting channel above for vulnerabilities
that could put users at risk, and avoid publishing secrets or personal data.

## Security model

With `DM_E2EE_ENABLED` enabled in `wrangler.jsonc`, direct messages are
end-to-end encrypted after both accounts have published encryption keys. Group
messages become encrypted once every member has a key; they stay encrypted and
the Worker rejects plaintext messages after that point. Older messages remain
readable if they were sent before encryption, and conversations without the
required keys can still use plaintext. Hub rooms and forums are not
end-to-end encrypted: their messages and attachments are readable by the
Worker.

Encrypted direct-message attachments are encrypted on the sending device before
upload. Their names, types and file keys are carried inside the encrypted
message. The Worker and Cloudflare store ciphertext, but can still see traffic
metadata such as participants, timing, group membership, message sizes and
attachment sizes. Private message keys stay on users' devices; the server-held
recovery backup is encrypted and requires the user's recovery code.

Direct-call and voice-room media uses WebRTC DTLS-SRTP. Account-key signatures
verify call signaling when available. Voice rooms allow unverified participants
when a device has no usable key, and show them without a verification lock.

## Audit status

On 2026-10-10, a local source audit identified ten findings, and fixes for those
findings are included in the current source. Validation completed: 837 root
tests passed and one was skipped; all 15 mobile reliability tests passed; root
and mobile type checks, lint, formatting checks and the web build passed.
Native-device testing, verification of a packaged signed Windows update and a
hosted penetration test were not performed. This audit does not establish that
all vulnerabilities have been found or that hosted systems are secure.
