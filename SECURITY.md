# Security Policy

DeCave is pre-release software. The latest source in this repository is the
only version maintainers can assess; no release support window or response
time is promised.

## Report a vulnerability

Use GitHub's private vulnerability reporting for this repository if it is
enabled. Otherwise, email **security@de-cave.com**. If neither channel is
available, open a minimal public issue asking for a private reporting channel
and do not include technical details.

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

In release 0.1.132, direct messages and group chats are end-to-end encrypted
after both direct-message participants, or every group member, have set up keys
in an up-to-date client. This covers message content and attachments, plus DM
reactions and poll votes. The Worker stores ciphertext and can see conversation
metadata, but not this encrypted content. Hub rooms, forums, and messages sent
before encryption remain readable by the service.

Voice, video, and screen-share media in direct calls and voice rooms uses
DTLS-SRTP between devices through Cloudflare TURN relays. A direct call rejects
an invalid signature, and rejects a missing signature when the peer's key is
available or pinned. If no peer key is available or pinned, an unsigned
description may proceed without a visible verification mark. Voice rooms may
also admit unverified participants, shown without a lock; a signaling-level
interception is not ruled out for unverified participants.
These implementation descriptions are not an independent security audit. The [encryption design and
known limits](docs/security/DM-E2EE.md) and [launch record and checklist](docs/security/DM-E2EE-LAUNCH.md)
describe what remains to verify. Do not treat this alpha software as a
substitute for an independent assessment.
