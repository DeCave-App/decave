# DeCave privacy and data routing

Status: **alpha engineering disclosure.** Direct messages and group chats
between people who all use an up-to-date client are end-to-end encrypted (see
[End-to-end encryption](../security/DM-E2EE.md)): the service stores only
ciphertext and metadata for them. Hub rooms, forums and messages sent before
encryption are stored and processed as readable content and attachments.
Voice, video and screen sharing in calls and voice rooms are end-to-end encrypted.
Voice and camera always use DTLS-SRTP between devices (with fingerprints signed by account
keys), as does screen audio; the TURN relay forwards only ciphertext. Screen video also uses
that peer path when the server switch `SCREEN_SFU_ENABLED` is off, for mobile or older clients,
for users without encryption keys, and on fallback. When the switch is on, screen-share video
from web/desktop sharers to web/desktop viewers instead goes through Cloudflare Realtime (an SFU):
picture content is AES-GCM encrypted on the sharer's device, while Cloudflare can still see
session/track metadata, the codec's unencrypted header bytes, frame sizes and timing (see the
Cloudflare Realtime row). TLS protects web traffic to Cloudflare. This document describes
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
  Cloudflare Turnstile, Cloudflare Calls/TURN, Cloudflare Realtime (SFU),
  Cloudflare Email,
  Discord public server templates, Steam, GIPHY, Expo Push
  Service -> APNs/FCM, Apple CallKit, and the device operating system

Build/distribution path (not a runtime chat route): Expo EAS is configured for
mobile builds, followed by the applicable Apple/Google distribution service.
```

Cloudflare terminates public TLS and operates the Worker, D1, R2, Durable
Objects, email binding, Turnstile, and TURN services used here. TLS protects
data in transit to Cloudflare; it does not hide message content from the service.
End-to-end encrypted DMs and group chats are the exception: their text,
attachments, and (in DMs) reactions and poll votes are encrypted on the
sender's device, and Cloudflare and DeCave hold only ciphertext, public keys, a
recovery-code-encrypted key backup, the account's history setting, and metadata
(participants and group members, timing, sizes, and that someone reacted).

## What goes where

| Route or store | Data sent or stored | Can DeCave/hosting service read it? | Why |
| --- | --- | --- | --- |
| Cloudflare Worker and edge | Request path, time, source network information, session cookie or mobile bearer token, user agent, request body | Yes | Authentication, authorization, abuse control, API and realtime delivery |
| D1 account and social tables | Email, username, salted password verifier, profile, public account ID, session/token digests, memberships, roles, moderation and security events | Yes | Account and community operation |
| D1 message tables | DM, group, and channel text, reactions, replies, pins, and attachment metadata | **Yes** | Message delivery, history, search, and moderation |
| R2 media bucket | Avatars, Hub media, and message attachments | Yes | Media delivery |
| Durable Object | Authenticated live sockets, presence/routing state, Hub/channel routing, call signalling | Yes for routing and signalling metadata; no durable message-content store is intended there | Realtime fan-out and call setup |
| Cloudflare observability | Sampled Worker request/runtime diagnostics and platform metadata | Potentially | Operations and incident response. Worker traces are disabled and head sampling is configured at 10%; message bodies and tokens must never be logged |
| Turnstile | The widget runs in the browser and talks to Cloudflare directly; Siteverify receives only the challenge token (DeCave does not send `remoteip`) | Yes, by Cloudflare | Bot and abuse protection during registration, login, and recovery |
| Cloudflare Calls/TURN | Temporary ICE server credentials; network candidates and media-path metadata during calls | Yes for routing metadata; media is DTLS-SRTP encrypted end to end between devices | Voice, camera, and screen transport |
| Cloudflare Realtime (SFU) | Only screen-share video from web/desktop sharers to web/desktop viewers, and only when `SCREEN_SFU_ENABLED` is on. Cloudflare sees session and track metadata, the codec's unencrypted header bytes (the VP8 payload header; VP9: none), frame sizes and timing; not picture content. Each frame is AES-GCM encrypted on the sharer's device with a per-share stream key, sealed to each viewer's account key and rotated when someone leaves. SFU connections are relay-only like other calls. As with existing call signalling, key distribution trusts the server's voice-room membership list: a compromised server could add a participant, who would then receive the stream keys | Yes for session/track and timing metadata; picture content is not readable | Screen-share video fan-out. Mobile, older clients, screen audio, voice, and camera stay on the DTLS-SRTP peer path; users without encryption keys also get the peer path |
| Other call participants | Nothing network-level: calls are relay-only (`iceTransportPolicy: "relay"` on every client, and the Worker forwards only relay ICE candidates), so peers see Cloudflare TURN addresses, never each other's IPs | No | Establishing a realtime media path |
| Cloudflare Email binding | Recipient email address and verification/password-reset content | Yes, by the email delivery chain | Transactional account email |
| Steam | OpenID values and, when linked, Steam ID/profile lookup | Yes, by Steam | Optional identity linking and public game activity |
| GIPHY | Search words, forwarded by the Worker with DeCave's API key. GIF media is fetched by the Worker (`/api/giphy/media`) without user headers, so GIPHY never receives a user's IP or identity | Search text only | Optional GIF search and display |
| Expo Push Service (runtime) | Expo push token, notification title/body, and an internal route are sent for delivery; the token is stored in D1 with its account and authenticated-session binding | Yes, by DeCave and Expo; the device OS displays the notification according to lock-screen settings | Push alerts when the recipient has no open realtime connection. Expo receives the notification payload and destination token |
| Anthropic API (bot builder "describe it", optional) | Only when a Hub admin with Manage Bots uses it (at most 5 times per Hub per UTC day, and only if `ANTHROPIC_API_KEY` is configured): the admin's description (at most 1000 characters), the rule catalogue, the Hub's text/forum room, voice room and role names and ids, and, when editing, the rule being edited. No usernames, member lists or message text (`worker/bots/ai.ts`) | Yes, by Anthropic | Drafting bot rules from a plain-language description; the drafts return to the admin and are not published automatically |
| Discord public templates | Worker retrieves a public template definition for the preview; a Hub owner may apply its sanitized structure | Discord sees the template lookup; DeCave sees the returned template structure | Optional Hub import; no Discord account connection or private message import |
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

No advertising SDK or behavioral analytics SDK is intentionally present in the
reviewed application path. The only AI-model API is the optional bot-builder
"describe it" call to Anthropic listed above. This is a source-code observation,
not proof about the deployed Cloudflare account or externally injected scripts.

## Trust and Safety evidence

When a user attaches evidence to a report, the client encrypts that evidence
before upload with the Trust and Safety key so only the authorized safety
process can review it. Submitting evidence discloses the selected content to
that process.

## Retention and deletion

Retention is enforced by the hourly Worker cron (`worker/retention.ts`,
`RETENTION_DAYS`) and published in the Privacy Policy, whose table a test
checks against the code (`scripts/__tests__/privacy-policy-sync.test.mjs`):

| Category | Retention |
| --- | --- |
| Sessions, session clients, push tokens of ended sessions, realtime/auth/secure-account/re-auth tokens, QR challenges | Deleted on expiry or use |
| Security events (event, user agent, detail; no IP) | 180 days |
| Known devices (fingerprint only) | 365 days after last use |
| Report evidence (R2 objects and rows) | 183 days after case closure, unless on legal hold |
| Closed cases, reports and actions | 365 days after closure, unless on legal hold |
| Platform and moderation audit logs | 365 days (the moderation log's append-only trigger now allows deleting only entries past that period) |
| Hub audit log | 183 days |
| Feedback | 365 days |
| Bot run log (`decave_bot_runs`: rule, trigger type, outcome, short detail) | 30 days |
| Expired Squad Finder searches | Deleted on expiry |
| DM uploads not referenced by any message | 1 day |
| Accounts found under 18 | Scheduled for erasure after a 30-day grace period |
| Account erasure | 30 days after the deletion request (`eraseDueAccounts`) |

Messages and community content persist until a user or moderator deletes
them, a parent resource is deleted, or account erasure applies. Deleting a DM
also deletes its attachment objects. Cloudflare Workers Logs (10% head
sampling) and D1 Time Travel follow the plan's retention (days for logs, up to
30 days for point-in-time recovery). Android application-data backup is
disabled so session tokens are not copied through Google backup.

A one-time R2 inventory is still recommended for objects orphaned by older
erasure code and by the removed end-to-end-encryption feature (migration 0056);
objects must not be deleted speculatively.

Failed R2 deletions (DM attachments, Hub media, uploads never sent in a
message) are recorded in `decave_media_deletion_queue` and retried by the hourly
cron (`worker/retention.ts`), so physical object removal can lag the D1
deletion. The same cron also drops "last online" timestamps after 180 days and
push tokens not bound to a sign-in after 90 days.

## Access and operational controls still required

Before public testing, DeCave must publish and verify all of the following:

1. The legal entity/controller identity, contact address, applicable region,
   lawful bases, age rules, user rights, and complaint route.
2. An exact subprocessor list and processing regions based on the deployed
   Cloudflare, email, Steam, GIPHY, Expo/EAS, and app-store configurations.
3. Confirmation of provider log and backup retention on the production plan
   (application retention is implemented and tested, see above).
4. Who can access production Cloudflare data, MFA/hardware-key requirements,
   least-privilege roles, access review cadence, and incident-response process.
5. A documented export, privacy-request, account-erasure, R2 orphan-cleanup,
   legal-hold, and incident/breach procedure with an auditable execution trail,
   including supervisory-authority notification within 72 hours and notice to
   affected users where GDPR/UK GDPR requires it.
6. Removal or rotation of any credential that has ever appeared in a source
   archive, SQL backup, local environment file, build output, or public post.
7. Confirmation of the international-transfer mechanisms (Cloudflare global
   network; Standard Contractual Clauses and/or EU-US Data Privacy Framework
   where applicable) described in Privacy Policy section 8.

Security or privacy claims on the website and app must link to the published
version of this routing disclosure and the retention schedule. “Encrypted” must
always say whether it means TLS transport, WebRTC media transport, or Trust and
Safety evidence encryption.
