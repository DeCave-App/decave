# DeCave privacy and data routing

Status: **alpha engineering disclosure, not approved for publication.** The service stores and processes
readable message content and attachments. TLS protects web traffic to
Cloudflare, and WebRTC media is encrypted in transit. This document describes
the routes visible in this repository. It must be reconciled with the deployed Cloudflare account,
contracts, log settings, and a legal privacy notice before any public release.

The current legal-document drafts are [Privacy Policy](PRIVACY-POLICY.md) and
[Terms of Service](TERMS-OF-SERVICE.md). The controller identity/address and
launch countries have not been provided; provider contracts, processing
regions, and external retention settings are unverified. Release publication
remains blocked until those details are supplied and the documents are
explicitly approved.

Do not ask alpha testers to submit sensitive conversations or files.

## Data-flow summary

```text
Browser / desktop app / mobile app
              |
              | HTTPS and WSS
              v
      Cloudflare edge + Worker
        |        |        |
        |        |        +-- Durable Object: live connection and call routing
        |        +----------- R2: avatars, Hub media, message attachments
        +-------------------- D1: accounts, authorization, communities, messages

Optional, feature-specific routes from the Worker or client:
  Cloudflare Turnstile, Cloudflare Calls/TURN, Cloudflare Email,
  Discord public server templates, Steam, GIPHY, Expo Push
  Service -> APNs/FCM, Apple CallKit, and the device operating system

Build/distribution path (not a runtime chat route): Expo EAS is configured for
mobile builds, followed by the applicable Apple/Google distribution service.
```

Cloudflare terminates public TLS and operates the Worker, D1, R2, Durable
Objects, email binding, Turnstile, and TURN services used here. TLS protects
data in transit to Cloudflare; it does not hide message content from the service.

## What goes where

| Route or store | Data sent or stored | Can DeCave/hosting service read it? | Why |
| --- | --- | --- | --- |
| Cloudflare Worker and edge | Request path, time, source network information, session cookie or mobile bearer token, user agent, request body | Yes | Authentication, authorization, abuse control, API and realtime delivery |
| D1 account and social tables | Email, username, salted password verifier, profile, public account ID, session/token digests, memberships, roles, moderation and security events | Yes | Account and community operation |
| D1 message tables | DM, group, and channel text, reactions, replies, pins, and attachment metadata | **Yes** | Message delivery, history, search, and moderation |
| R2 media bucket | Avatars, Hub media, and message attachments | Yes | Media delivery |
| Durable Object | Authenticated live sockets, presence/routing state, Hub/channel routing, call signalling | Yes for routing and signalling metadata; no durable message-content store is intended there | Realtime fan-out and call setup |
| Cloudflare observability | Sampled Worker request/runtime diagnostics and platform metadata | Potentially | Operations and incident response. Worker traces are disabled and head sampling is configured at 10%; message bodies and tokens must never be logged |
| Turnstile | Challenge token, action/hostname, and source IP sent to Siteverify | Yes, by Cloudflare | Bot and abuse protection during registration, login, and recovery |
| Cloudflare Calls/TURN | Temporary ICE server credentials; your IP address, relay candidates, and media-path metadata during calls | Yes for routing metadata; media is DTLS-SRTP transport encrypted | Voice, camera, and screen transport. Clients use `iceTransportPolicy: "relay"` only and refuse to start voice or calls when no authenticated TURN server is available |
| Other call participants | Only the Cloudflare relay address; peers do not receive your IP address through the media connection because all voice and call media is relayed | No direct address exposure by design | Establishing a realtime media path |
| Cloudflare Email binding | Recipient email address and verification/password-reset content | Yes, by the email delivery chain | Transactional account email |
| Steam | OpenID values and, when linked, Steam ID/profile lookup | Yes, by Steam | Optional identity linking and public game activity |
| Discord public templates | Worker retrieves a public template definition for the preview; a Hub owner may apply its sanitized structure | Discord sees the template lookup; DeCave sees the returned template structure | Optional Hub import; no Discord account connection or private message import |
| GIPHY | Worker sends search/trending requests and retrieves supported returned GIF media through a restricted proxy | GIPHY receives search queries and media fetches from the Worker | Optional GIF search and display; client media requests are served by DeCave |
| Expo Push Service -> APNs/FCM (runtime) | Expo push token, notification title/body, and an internal route are sent for delivery; the token is stored in D1 with its account and authenticated-session binding | DeCave and Expo receive notification payload/token; Expo routes through Apple APNs or Google FCM; the device OS displays it according to notification and lock-screen settings | Push alerts when the recipient has no open realtime connection |
| Apple CallKit (iOS) | Active voice-room state, participant-facing room label and mute/end controls are reflected in system call UI | The device OS and CallKit manage system call presentation; this is not a recording path | System voice-room controls and audio-session integration |
| Expo EAS and app stores (build/distribution) | Source/build inputs, signing/build metadata, compiled apps, and store account/release data—not a runtime message-delivery route | Potentially, according to the actual build and store configuration | Mobile build and distribution. Exact contracts, regions, credentials, and retention still require verification |

Streamer Mode (when a Hub owner enables it) stores Hub configuration, play
sessions, the community queue (member, status, join/call/finish times),
giveaways and their entries and winners, highlights (title, link, thumbnail,
creator), a host/moderator audit trail, and per-member rate-limit counters in
D1. Queue and giveaway entries are deleted when the member leaves the Hub or is
erased.

Clients: web, Windows and Mac desktop (Electron), and iOS/Android mobile. The
desktop game-activity scan runs locally on Windows and macOS; only the game
name, source, app ID, and start time can be published, and executable paths
stay in the desktop main process. On logout, the web and desktop clients clear
account-specific browser storage and the desktop in-app browser profile.

No advertising SDK, behavioral analytics SDK, or AI-model API is intentionally
present in the reviewed application path. This is a source-code observation,
not proof about the deployed Cloudflare account or externally injected scripts.

## Trust and Safety evidence

When a user attaches evidence to a report, the client encrypts that evidence
before upload with the Trust and Safety key so only the authorized safety
process can review it. Submitting evidence discloses the selected content to
that process.

## Retention and deletion

The application has finite retention rules for credentials, security events,
feedback, and report evidence. They run on an hourly scheduled trigger using
bounded batches; the schedule can lag if a batch is not completed. Provider
logs, backups, replicas, caches, and processing regions are not configured by
these application rules and remain release blockers until verified.

Current code-level behavior is:

- Expired session, authentication-token, reset-link, and one-time challenge
  records are removed by the hourly cleanup. Revocation or consumption can
  remove them earlier.
- Message history and most community records persist until a user or
  authorized moderator deletes them, a parent resource is deleted, or account
  erasure applies.
- Current account erasure removes channel messages authored by the erased
  account and direct-message rows involving that account. It deletes legacy
  attachment objects referenced by those rows and tracked account-owned
  attachments and Hub assets. For report evidence, reporter identity is
  scrubbed; non-held evidence objects and rows are deleted, while evidence
  under legal hold is retained. Report evidence remains client-encrypted
  before upload and encrypted in R2.
- If account erasure happens before a security event reaches its 365-day
  expiry, the stored IP hash is replaced with `erased`; that event field never
  stores the raw source IP.
- Security events and feedback are deleted after 365 days by the scheduled
  cleanup. Report evidence is deleted at its explicit expiry, or 365 days after
  creation if none was set; evidence-level and moderation-case legal holds
  exclude it. Evidence deletion is bounded, and failed R2 deletions are queued
  for retries, so physical object removal may happen later.
- Provider-level logs, backups, replicas, and deletion windows are not defined
  by this source tree. They must be obtained from the actual service plan and
  contracts and disclosed before launch.
- `SECURITY_IP_HASH_KEY` is an optional Worker secret. If set, security-event
  IP values are stored as keyed HMAC-SHA-256 hashes. If absent, a key derived
  from `OWNER_MFA_ENCRYPTION_KEY` (with a fixed domain label) is used instead;
  if neither secret is set, the field is stored empty. Cloudflare and other network providers may still process
  source addresses as part of service delivery and abuse protection.
- Android application-data backup is disabled in source and native manifest so
  session tokens are not copied through Google backup or device transfer.

An older erasure implementation could leave R2 objects after losing their D1
ownership record. A one-time R2 orphan inventory and reviewed garbage-
collection procedure is required; objects must not be deleted speculatively.
The application cleanup does not set provider-side log, backup, replica, or
cache retention periods, and successful D1 deletion does not prove that those
independent copies have expired.

## Access and operational controls still required

Before public testing, DeCave must publish and verify all of the following:

1. The legal entity/controller identity, contact address, applicable region,
   lawful bases, age rules, user rights, and complaint route.
2. An exact subprocessor list and processing regions based on the deployed
   Cloudflare, email, Steam, GIPHY, Expo/EAS, and app-store configurations.
3. The code-level retention windows below, plus verified provider log, backup,
   replica, cache, and deletion-queue behavior for the deployed service plans.
4. Who can access production Cloudflare data, MFA/hardware-key requirements,
   least-privilege roles, access review cadence, and incident-response process.
5. A documented export, privacy-request, account-erasure, R2 orphan-cleanup,
   legal-hold, and incident/breach procedure with an auditable execution trail,
   including supervisory-authority notification within 72 hours and notice to
   affected users where GDPR/UK GDPR requires it (see Privacy Policy section 10).
6. Removal or rotation of any credential that has ever appeared in a source
   archive, SQL backup, local environment file, build output, or public post.
7. Confirmation of the international-transfer mechanisms (Cloudflare global
   network; Standard Contractual Clauses and/or EU-US Data Privacy Framework
   where applicable) described in Privacy Policy section 9.

Security or privacy claims on the website and app must link to the published
version of this routing disclosure and the retention schedule. “Encrypted” must
always say whether it means TLS transport, WebRTC media transport, or Trust and
Safety evidence encryption.
