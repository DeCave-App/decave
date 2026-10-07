# DeCave Privacy Policy

**Effective date:** October 5, 2026
**Last updated:** October 5, 2026
**Status:** Implementation draft pending controller details, deployment verification, and approval
Publication status: Draft.

> This is an implementation draft and is not approved for publication. The
> controller name and address, countries of operation, provider contracts and
> regions, applicable rights and complaint details, and final legal terms have
> not been supplied or verified. The release process blocks publication until
> those details are added and this notice is explicitly approved.

This Privacy Policy explains how **[LEGAL ENTITY NAME]** ("DeCave", "we", "us",
or "our") collects, uses, stores, and discloses information when you use the
DeCave website, web application, Windows and Mac desktop clients, mobile client, Hubs,
rooms, direct messages, voice and video features, screen sharing, support
features, and related services (together, the **Service**).

For privacy questions or requests, contact **security@example.invalid**. Our
controller address is **[CONTROLLER ADDRESS]**. If we appoint a data protection
officer or an EU/UK representative, their details will be added here before
the Service is offered on a basis that requires one.

## 1. What information we collect

We collect the following categories. We do not need every category for every
user or feature.

### Account, contact, and authentication information

- username, display name, public DeCave ID, email address, email-verification
  status, profile avatar, biography, custom status, accent, and account dates;
- a salted password verifier and password-reset or email-verification records;
  we do not intentionally store your password in readable form;
- session, bearer-token, WebSocket-token, device, client, and authorization
  records, including token digests, expiry times, client type, device label,
  platform, client build, and last-seen time; and
- account deletion, suspension, password-reset, recovery, and security-event
  records.

### Profile, social, and community information

Depending on what you use or publish, this includes friend requests and
friendships, blocks and mutes, presence and online state, activity text,
Hubs, rooms, memberships, roles, invitations, bans, timeouts, Hub settings,
forum settings, calendar or event information, Squad Finder preferences, and
public or restricted profile and community content.

### Streamer Mode

If a Hub owner turns on Streamer Mode, the Service also stores the Hub's
Streamer Mode settings; play-session details such as title, game, status,
party size, and timing; the community queue, including which members joined,
their position and status (for example waiting, called, ready, playing, or
done), and join, call, and finish times; giveaways, including title, rules,
closing time, status, the members who entered, entry times, and the drawn
winner; highlights, including title, link, thumbnail, creator, and creation
time; an audit trail of host and moderator actions; and short-lived
per-member rate-limit counters. Queue position, giveaway entries, and winners
can be visible to the host, moderators, and other Hub members. Queue entries
and giveaway entries are removed when you leave the Hub or your account is
erased.

Squad Finder may include the game, platform, language, region, microphone
preference, group, status, and expiry of a search. If you connect Steam, we
may receive and store your Steam ID and the public Steam profile information
returned by Steam, such as persona name, profile URL, avatar URL, game name,
and game identifier.

### Messages, media, and other user content

When you send, upload, react to, edit, pin, report, or otherwise submit
content, we may process:

- Hub, room, forum, direct-message, and group-message content and its
  identifiers, authors, recipients, replies, reactions, timestamps, edits,
  pins, and delivery state;
- attachment names, content types, sizes, object identifiers, hashes,
  access-control information, and the files themselves;
- Hub media, avatars, stickers, soundboard audio, links, embeds, and other
  files you choose to provide;
- feedback, support messages, and information you include in a support
  request; and
- report descriptions, target and context identifiers, category, urgency,
  client version, moderation decisions, case notes, and evidence you choose
  to attach.

Do not send passwords, private keys, payment-card data, government ID numbers,
or highly sensitive personal information unless an authorized process
specifically requires it. User content can contain personal information about
other people; you are responsible for having the right to submit it.

### Voice, camera, screen sharing, and realtime information

If you join a voice room, make a call, enable a camera, or share your screen,
the Service processes the session and routing information needed to establish
and maintain it, such as participant identifiers, join/leave state, mute and
deafen state, camera and screen-sharing state, signalling messages, ICE
candidates, connection identifiers, quality or transport metadata, and
network-address information. Other participants may see or receive your
voice, camera, screen, display name, avatar, and related session state.

The application is not designed to record voice, camera, or screen sessions by
default. A participant or a third-party operating-system, browser, recording,
or capture tool may nevertheless record or reproduce what they can receive.
Voice rooms and calls are relayed through Cloudflare's TURN relay service
(Cloudflare Calls/TURN). The clients are configured to use only relayed
connections, so other participants connect to the relay rather than directly
to your device and do not receive your IP address through the media
connection. Cloudflare, acting as our relay provider, processes your IP address
and media-path metadata to carry the session. If the relay is unavailable,
voice and calls do not start instead of falling back to a direct connection.

### Device, network, usage, and diagnostic information

When a browser, desktop client, or mobile client connects, the Service may
receive:

- IP address or a derived/hash value used for abuse prevention, rate limiting,
  and security records; Cloudflare edge metadata such as country and request
  or connection identifiers; and request date, time, path, method, status, and
  user-agent information;
- session activity, last-seen time, presence transitions, realtime connection
  state, feature and endpoint use, client version, platform, and device
  metadata;
- error, performance, security, moderation, and sampled operational
  diagnostics; and
- information needed to detect automated abuse, verify a human, investigate
  incidents, enforce access controls, and protect the Service.

The current source does not intentionally include an advertising SDK,
behavioral advertising SDK, or AI-model API. This statement does not override
telemetry or processing performed by a third-party provider that you choose to
use or by the infrastructure account running a deployment.

### Desktop game activity

If you enable automatic activity in the Windows or Mac desktop client, the
client can read running processes and local Steam/Epic installation metadata to match
the game currently running. The scan is performed locally. The client may
publish the selected game name, source, application ID, and start time to your
DeCave profile so that other people can see your activity. Local executable
paths, process IDs, and the full installed-game list are not intended to be
sent to the Service. You can turn off local detection or automatic publishing
in the client settings.

### Local storage and device permissions

The client and website may store settings, theme choices, privacy choices,
notification-preview choices, session state, cached content, drafts, and
desktop preferences in browser or operating system storage. The desktop client
uses a persistent local application profile and may store update, window,
overlay, keybind, or other local preferences. When you log out of the web or
desktop client, it removes the account-specific data it stored in the browser
(such as drafts, notes, mutes, notification and privacy settings, and in-app
browser history) and the desktop client clears its in-app browser profile;
device-level preferences such as theme, language, and audio devices remain.

The Service may request browser or operating-system permission to use a
microphone, camera, screen, notifications, or a file picker. A notification
preview can contain text or a route chosen by the app; the operating system
controls how it appears on your lock screen. You can revoke these permissions
in your browser or operating-system settings.

The marketing website uses local storage for the visual theme preference. We
do not intentionally use advertising cookies. Authentication cookies and
security cookies or challenge storage may be necessary for the application to
work.

### Optional third-party features

If enabled on the deployment, the Service can make feature-specific requests
to or load content from third parties, including:

- **Cloudflare:** Workers, D1, R2, Durable Objects, Turnstile, Calls/TURN,
  edge delivery, email, rate limiting, and observability;
- **Discord:** a Hub owner can retrieve and preview a public Discord server
  template through the Discord API, then choose to import its structure. This
  does not connect a Discord account or import private Discord messages;
- **Steam:** OpenID account linking and public Steam profile or activity data;
- **GIPHY:** search and trending requests go from the Worker to GIPHY. Returned
  GIF media is fetched by the Worker through a restricted proxy and served to
  the client from DeCave; GIPHY still processes search and media fetches;
- **Expo, Apple, and Google push services:** the Worker sends an Expo push
  token and notification title, body, and route to Expo's push service. Expo
  routes delivery through Apple Push Notification service (APNs) or Firebase
  Cloud Messaging (FCM), as applicable; the device operating system controls
  notification display, including lock-screen previews;
- **Apple CallKit:** on iOS, an active DeCave voice room can be represented in
  the system call UI and controlled through CallKit. This does not mean DeCave
  records the call;
- **app stores and build/distribution providers:** account, build, signing,
  release, and distribution information for clients you install.

Those providers may process information under their own privacy notices. The
exact deployed provider list, contractual roles, processing locations,
international-transfer safeguards, and provider retention periods have not
been verified and remain publication blockers.

## 2. Why we use information

We use information for the following purposes:

1. to create and secure accounts, authenticate users, verify email addresses,
   recover accounts, manage devices and sessions, and provide the Service;
2. to deliver messages, files, presence, notifications, Hubs, social features,
   matchmaking, calls, voice, camera, and screen-sharing sessions;
3. to store and display the profile, activity, messages, media, and community
   content that you or authorized community members choose to publish;
4. to operate moderation, reporting, blocking, abuse prevention, age and teen
   safety controls, trust and safety investigations, legal holds, and appeals;
5. to diagnose failures, maintain availability, measure basic operational
   reliability, improve features, and provide support;
6. to verify humans, rate-limit requests, prevent fraud, protect accounts and
   infrastructure, and investigate or respond to security incidents;
7. to comply with law, valid legal process, and requests from competent
   authorities; and
8. to complete a merger, acquisition, financing, reorganization, or sale of
   assets, subject to applicable law and appropriate confidentiality controls.

We do not use the content of your messages to create advertising profiles or
train an AI model. We do not intentionally sell personal
information or share it for cross-context behavioral advertising. We may still
disclose information to infrastructure providers, moderators, other users as
the feature requires, professional advisers, law enforcement, or a successor
entity as described here.

## 3. Legal bases where GDPR or UK GDPR applies

If the GDPR, UK GDPR, or a similar law applies, the legal basis depends on the
processing:

- **Contract:** account creation, authentication, delivery of the Service,
  realtime features, support, and features you request;
- **Legitimate interests:** security, abuse prevention, moderation, service
  reliability, product operations, and protecting users and the Service,
  balanced against your rights;
- **Legal obligation:** tax, legal-process, safety, recordkeeping, and
  regulatory duties; and
- **Consent:** optional features or processing for which consent is required,
  such as certain device permissions or future marketing. You may withdraw
  consent where the law gives you that choice.

Providing an email address, username, and authentication information is
generally necessary to create and use an account. If you do not provide
required information, we may not be able to provide the requested feature.

We do not make decisions based solely on automated processing that produce
legal or similarly significant effects. Automated rate limits, abuse signals,
feature eligibility checks, safety triage, and recommendations may affect the
availability or ordering of a feature, but they are intended to support human
review and service operation rather than make a legal decision about you.

## 4. When we disclose information

We disclose information only as reasonably necessary for the purposes above,
including to:

- **other users and community operators** when you use a social, public,
  realtime, or community feature, or when a moderator needs to administer a
  Hub;
- **service providers and subprocessors** that host, deliver, secure, email,
  moderate, analyze, or support the Service on our instructions;
- **optional third-party providers** when you request an integration, search,
  embed, GIF, activity, or similar feature;
- **professional advisers, insurers, auditors, and transaction parties** under
  confidentiality obligations;
- **law enforcement, courts, regulators, or safety organizations** when
  disclosure is required or reasonably necessary to comply with law, protect
  people, investigate abuse, or protect rights and property; and
- **a successor organization** in a merger, acquisition, reorganization, or
  sale of assets, subject to applicable law.

A user who shares content, invites a person to a Hub, joins a
voice session, enables a public profile, or submits evidence may make that
content available to the selected recipients.

## 5. Messaging and transport security

The Service stores message content and attachments in readable form so it can
deliver, sync, search, moderate, and operate those features. TLS protects
traffic between your device and the Cloudflare edge. WebRTC media is encrypted
in transit between participants.

Authorized DeCave staff and service providers acting for us may be able to
access stored content when that is needed to operate, secure, or moderate the
Service, or when the law requires it. The Service also processes metadata such
as account and Hub relationships, routing identifiers, sizes, timestamps,
delivery state, IP or network information, and call-signalling data.

No system guarantees that a recipient will not copy or disclose content after
receiving it.

Trust and Safety evidence is a separate path: when you select evidence for a
report, the client is designed to encrypt that evidence before upload so an
authorized safety process can review it. Submitting evidence discloses the selected
content to that safety process.

## 6. Retention and deletion

We keep information only for as long as reasonably necessary for the purpose
for which it was collected, account operation, security, safety, dispute
resolution, legal obligations, and legitimate backup or recovery processes.

The application runs bounded retention cleanup from an hourly scheduled job.
Each run handles limited batches, so records can remain past the stated
retention period while cleanup catches up. Failed R2 object deletion remains
queued for retries; database deletion can therefore precede physical removal
of an object. These application rules do not define provider logs, backups,
replicas, or transfer regions, which must be verified against deployed services
before publication:

| Category | Current retention rule or criterion |
| --- | --- |
| Expired sessions, authentication tokens, reset links, and one-time challenges | Removed by the hourly scheduled cleanup after expiry. Revocation or consumption can remove them earlier. |
| Profiles, memberships, settings, messages, reactions, forums, attachments, and community records | While needed to provide the feature and until you, an authorized moderator, a parent resource, or account-erasure process deletes them, subject to safety, backup, and technical-cleanup exceptions. |
| Security events and feedback | Deleted by the hourly scheduled cleanup after 365 days. This application schedule does not define platform-level diagnostic logs. |
| Encrypted report evidence | Deleted at its explicit `retention_expires_at`, or 365 days after creation when no override is set. Evidence-level or case-level legal holds prevent this cleanup. R2 removal uses a retryable deletion queue. |
| Hub moderation log | Deleted by the hourly scheduled cleanup after 365 days. |
| Platform administration audit log | Deleted by the hourly scheduled cleanup after 730 days. |
| Remembered sign-in devices and last-online times | Deleted 180 days after the device or account was last seen. |
| Push notification tokens and subscriptions | Deleted as soon as the signed-in session they belong to ends, or after 90 days for tokens without a session link. Subscriptions to a deleted Hub or room are removed. |
| Uploads that were never attached to a message | Deleted about 24 hours after upload. |
| Reports, moderation cases, and moderation-action records | Retained while needed to investigate, resolve, appeal, prevent repeat abuse, comply with law, or preserve a legal hold; finite deletion rules vary by record. |
| Optional integration records | Until you disconnect the integration, delete the account, or the record is no longer needed for the feature or legal purposes. |
| Local device data | Until you clear application data, uninstall, revoke a permission, or the operating system removes it. Uninstalling does not automatically delete server data. |

Current account erasure removes channel messages authored by the erased
account and direct-message rows involving that account. A self-service deletion
request is scheduled for completion after a 30-day grace period; an authorized
administrator can execute an immediate erasure. Erasure deletes legacy
attachment objects referenced by those rows and tracked account-owned
attachments and Hub assets. Reporter identity is scrubbed from retained report
evidence. Non-held report evidence objects and rows are deleted; evidence under
legal hold is retained. Other users may have copies they saved before deletion.
Provider backups, replicas, caches, and orphan-object deletion windows depend
on the deployed service and are not fully defined by this source tree.
If account erasure happens before a security event reaches its 365-day expiry,
the stored IP hash is replaced with `erased`; the event does not store the raw
source IP in that field.

## 7. Your choices and privacy rights

You can change profile, privacy, notification, activity, friend-request,
stream-preview, and integration settings in the Service where available. You
can decline optional permissions, disconnect Steam, disable automatic game
activity, avoid optional searches or embeds, delete content where the feature
allows it, download an account-data export in account settings (it includes messages you sent and received, reactions, reports you filed, and masked push-token details), and request
account deletion in the app.

Depending on where you live and subject to legal exceptions, you may have the
right to:

- access the personal information we hold about you and receive a copy;
- correct inaccurate or incomplete information;
- delete information or close your account;
- restrict or object to certain processing;
- receive portable information in a structured, commonly used format;
- withdraw consent where processing relies on consent;
- opt out of sale or sharing for cross-context behavioral advertising, where
  those rights apply; and
- receive service without unlawful discrimination for exercising a privacy
  right; and
- complain to your local data-protection or privacy regulator.

For a privacy request that is not handled by those controls, email
**security@example.invalid** with the subject **Privacy request** and describe the
right you want to exercise. We may ask for reasonable information to verify
that you control the account and may limit a request where law permits or
requires us to do so. We aim to respond within the time required by applicable
law. Before a California-covered launch, we will publish the additional
request method required by California law if one is applicable.

If you are in the European Economic Area or United Kingdom, add the applicable
controller, representative, supervisory-authority, and international-transfer
details to this policy before relying on this section for public launch.

## 8. Children and age requirements

New account registrations currently require the applicant to be at least 18.
This is DeCave's conservative product rule while launch countries and their
requirements remain undecided; it is not a statement that 18 is the legal
minimum everywhere. Existing accounts are not retroactively required by this
signup rule to re-confirm age. Registration uses a self-attested birth date to
derive an age band and eligibility status; the exact birth date is not stored.
Where local law requires a higher minimum age or parental authorization, the
applicable rule still applies. If you believe an ineligible child has provided
personal information, contact **security@example.invalid**.

The Service may ask for an age band, age status, age acknowledgment or age-
safety setting to apply safety controls. We do not ask for a government ID as
part of the ordinary age gate. Any future age-verification provider and its
data handling will be described before use.

## 9. International data transfers

<!-- LEGAL REVIEW REQUIRED: confirm the transfer mechanisms, Cloudflare DPA/SCC
version, Data Privacy Framework certification status of each provider, and any
UK Addendum / Swiss amendments before publication. -->

DeCave runs on Cloudflare's global network. Requests are handled at the
Cloudflare location nearest to you, and stored data and processing by
Cloudflare and optional providers can take place in countries other than the
country where you live, including the United States. Those countries may not
offer the same level of data protection as your own.

Where the GDPR, UK GDPR, or Swiss law applies and personal data is transferred
to a country without an adequacy decision, we rely on appropriate safeguards:
the European Commission's Standard Contractual Clauses (with the UK Addendum or
Swiss amendments where applicable) included in our providers' data processing
terms, and, for US providers certified under it, the EU-US Data Privacy
Framework and its UK and Swiss extensions. You may contact us to request
information about the safeguards that apply to your data.

## 10. Security

We use measures appropriate to the risk and the feature, including encrypted
transport, password hashing, token hashing, access controls, rate limiting,
owner MFA controls, security logging, account-erasure tooling, and client-side
encryption of selected safety evidence. No system, network, storage provider,
or transmission method is completely secure. Keep your password and devices
safe, and tell us promptly if you suspect compromise.

### Security incidents and breach notification

<!-- LEGAL REVIEW REQUIRED: confirm the incident-response procedure, the
competent supervisory authority, and notification duties in each launch
country before publication. -->

If we become aware of a personal data breach, we will investigate it, take
steps to contain it, and record it. Where the GDPR or UK GDPR requires, we will
notify the competent supervisory authority without undue delay and, where
feasible, within 72 hours of becoming aware of the breach. If a breach is
likely to result in a high risk to your rights and freedoms, we will also
notify affected users without undue delay, describing what happened, the likely
consequences, and the steps we have taken and you can take. Other applicable
laws may require additional notices, which we will provide.

## 11. Changes to this policy

We may update this policy when the Service, law, providers, or data practices
change. We will update the effective date and, where required, give additional
notice or obtain consent. Continuing to use the Service after an updated
policy takes effect means the updated policy applies to future processing;
where law requires consent, we will ask for it.

## 12. Contact

**Privacy and security contact:** security@example.invalid  
**Controller:** [LEGAL ENTITY NAME]  
**Address:** [CONTROLLER ADDRESS]

Please do not include passwords, private keys, unredacted conversations, or
unnecessary personal information in a privacy or security email.
