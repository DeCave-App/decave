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

In this checkout, message text and attachments are readable by the Worker and
are not end-to-end encrypted. HTTPS/WSS protects traffic to Cloudflare, and
WebRTC media uses DTLS-SRTP in transit. Do not send sensitive conversations or
files through an instance built from this alpha code.
