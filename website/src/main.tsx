import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Download,
  ExternalLink,
  Gamepad2,
  Globe2,
  Layers3,
  LockKeyhole,
  Mail,
  Menu,
  MessageCircle,
  Mic2,
  Monitor,
  MonitorUp,
  Radio,
  Rocket,
  Search,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Users,
  Volume2,
  X,
  Zap,
} from "lucide-react";
import "./styles.css";

const RELEASE_STATUS_URL = "/roadmap";
const WINDOWS_OPERATOR_DOWNLOAD_URL = "/downloads/DeCaveSetup.exe";
const MAC_APPLE_SILICON_DOWNLOAD_URL = "https://downloads.de-cave.com/DeCave-Mac-arm64.dmg";
const MAC_INTEL_DOWNLOAD_URL = "https://downloads.de-cave.com/DeCave-Mac-x64.dmg";
const CURRENT_OPERATOR_VERSION = "0.1.94";
const ANDROID_OPERATOR_DOWNLOAD_URL = "/downloads/DeCave-0.1.89-operator-waived.apk";
const OPERATOR_RELEASE_METADATA_URL = "/downloads/operator-release.json";


// Publication status: Draft.
function PrivacyPage() {

  return (
    <InfoLayout
      page="privacy"
      eyebrow="Privacy & data"
      title={<>Privacy policy<br /><span>with the edges visible.</span></>}
      lead="This notice explains what DeCave collects, why it is needed, where it goes, and what the current release does and does not protect."
      updated="Effective 5 Oct 2026 · Draft"
    >
      <div className="disclosure-banner">
        <ShieldAlert size={19} />
        <span><strong>Publication status: Draft.</strong> DeCave has not supplied its controller name, address, or launch countries. Provider contracts and processing regions remain unverified. Public release stays blocked until these details and the final notice are reviewed and approved.</span>
      </div>
      <div className="info-columns">
        <aside className="info-aside">
          <span>On this page</span>
          <a href="#privacy-controller">Controller</a>
          <a href="#privacy-collection">What we collect</a>
          <a href="#privacy-use">How we use it</a>
          <a href="#privacy-routing">Where it goes</a>
          <a href="#privacy-encryption">Encryption</a>
          <a href="#privacy-retention">Retention</a>
          <a href="#privacy-rights">Your rights</a>
          <a href="#privacy-contact">Contact</a>
        </aside>
        <article className="policy-article">
          <section id="privacy-controller">
            <h2>1. Who is responsible</h2>
            <p>The controller name and address have not yet been supplied. Privacy and security requests can be sent to <a href="mailto:security@example.invalid">security@example.invalid</a>. Any required data-protection officer or representative must be identified for the selected launch countries before publication.</p>
            <p>This draft describes source-code behavior. The deployed Cloudflare account, optional integrations, provider contracts, processing regions, and platform retention settings have not been verified.</p>
          </section>

          <section id="privacy-collection">
            <h2>2. What we collect</h2>
            <p>We collect only the information needed for the features you use. Depending on your account and settings, that can include:</p>
            <div className="data-table">
              <div><strong>Account &amp; authentication</strong><span>Username, email, public DeCave ID, profile data, password verifier, session and token digests, device/client metadata, verification, recovery, suspension, and security records.</span></div>
              <div><strong>Community &amp; social</strong><span>Friends, blocks, mutes, presence, activity, Hubs, rooms, memberships, roles, invitations, bans, timeouts, forum data, events, and Squad Finder choices such as game, platform, language, region, and microphone preference.</span></div>
              <div><strong>Messages &amp; files</strong><span>Messages, replies, reactions, edits, pins, forum posts, avatars, attachments, Hub media, stickers, soundboard audio, filenames, types, sizes, object identifiers, and access-control metadata.</span></div>
              <div><strong>Voice &amp; realtime</strong><span>Join/leave state, participant and connection identifiers, mute/deafen, camera and screen-share state, signalling, ICE candidates, transport metadata, and network-address information. Voice and calls are relayed through Cloudflare TURN, so other participants do not receive your IP address through the media connection; if the relay is unavailable, voice and calls do not start. The app is not designed to record sessions by default.</span></div>
              <div><strong>Streamer Mode</strong><span>When a Hub owner enables it: Hub Streamer Mode settings, play sessions, the community queue (who joined, position, status, and join/call/finish times), giveaways with their rules, entries, and winners, highlights (title, link, thumbnail, creator), a host and moderator audit trail, and short-lived rate-limit counters. Queue and giveaway entries are removed when you leave the Hub or your account is erased.</span></div>
              <div><strong>Safety &amp; support</strong><span>Feedback, reports, categories, urgency, descriptions, target/context identifiers, client version, moderation cases, case notes, audit events, legal holds, and evidence you choose to submit.</span></div>
              <div><strong>Technical &amp; security</strong><span>IP address handled at the Cloudflare edge; security-event IPs are stored as keyed hashes only when the optional SECURITY_IP_HASH_KEY secret is configured, and otherwise this field is empty. We also process user agent, request time/path/status, Cloudflare edge identifiers and country, session activity, rate-limit signals, errors, performance data, and sampled operational diagnostics.</span></div>
              <div><strong>Optional features</strong><span>Discord public server-template lookups for owner-chosen Hub imports; Steam profile/activity data; GIPHY search and proxy-served GIF media; Windows and Mac desktop game-activity signals (the scan runs locally and executable paths are not sent); Expo push tokens and notification payloads; and app-store or distribution data when you use those features.</span></div>
            </div>
            <div className="policy-callout"><Check size={16} /><span>We do not intentionally store readable passwords, use an advertising SDK, use a behavioral advertising SDK, or send user content to an AI-model API in the reviewed application path.</span></div>
          </section>

          <section id="privacy-use">
            <h2>3. Why we use it</h2>
            <p>We use information to create and secure accounts, authenticate and recover access, deliver Hubs, rooms, messages, files, presence, notifications, matchmaking, calls, voice, camera, and screen sharing, show the profile and content you choose to publish, operate reporting and moderation, prevent abuse and fraud, troubleshoot and improve the Service, provide support, comply with law, and handle a transaction involving the Service.</p>
            <p>Where GDPR or UK GDPR applies, the basis may be contract, legitimate interests in security and operation, legal obligation, or consent for optional processing where consent is required. We do not make decisions based solely on automated processing that produce legal or similarly significant effects.</p>
          </section>

          <section id="privacy-routing">
            <h2>4. Where it goes</h2>
            <p>Web, Windows and Mac desktop, and mobile clients connect over HTTPS and WSS to Cloudflare Workers, D1, R2, Durable Objects, Turnstile, Calls/TURN, email, rate-limiting, and observability services. Voice and call media always goes through the Cloudflare TURN relay rather than directly between participants. A Hub owner can retrieve and preview a public Discord server template through the Discord API, then choose to import its structure; this does not connect a Discord account or import private messages. Steam is used for account linking and public profile/activity data. GIPHY search requests and media retrieval go from the Worker to GIPHY, and returned media is served to the client through a restricted DeCave proxy. Mobile push sends an Expo token and notification title, body, and route to Expo's push service, which routes delivery through APNs or FCM; iOS CallKit can show and control an active voice room in system call UI.</p>
            <p>The exact deployed provider list, contractual roles, processing locations, international-transfer safeguards, and provider retention periods have not been verified and remain publication blockers.</p>
            <p>We do not sell personal information or intentionally share it for cross-context behavioral advertising. We may disclose information to providers acting for us, other users as the feature requires, moderators and safety reviewers, professional advisers, a successor organization, or authorities when legally required or reasonably necessary to protect people, rights, or the Service.</p>
          </section>

          <section id="privacy-encryption">
            <h2>5. Messaging and encryption</h2>
            <p>DeCave stores message content and attachments in readable form to deliver, sync, search, and moderate them. TLS protects web traffic to Cloudflare, and WebRTC media is encrypted in transit between participants and relayed through Cloudflare TURN. When you log out of the web or desktop client, account-specific data stored in the browser and the desktop in-app browser profile are cleared; device preferences such as theme, language, and audio devices remain. DeCave also processes account, participant, routing, timing, size, delivery, IP/network, and signalling metadata. Recipients can copy or record what they receive.</p>
            <p>If you select evidence for a safety report, the client encrypts that evidence before upload so only an authorized safety process can review it. That submission discloses the selected content to the safety process.</p>
          </section>

          <section id="privacy-retention">
            <h2>6. Retention and deletion</h2>
            <p>An hourly scheduled job removes expired sessions and authentication credentials, and deletes security events, feedback and the Hub moderation log after 365 days, the platform administration audit log after 730 days, remembered sign-in devices and last-online times 180 days after last use, push tokens when their session ends, and uploads that were never attached to a message after about 24 hours. Account erasure clears that account's stored IP hash from retained security events; the event field does not store raw source IP. Report evidence is deleted at its explicit retention expiry or, when none is set, 365 days after creation. Evidence-level or case-level legal holds exclude evidence from cleanup. Each run is batch-limited, and failed R2 deletions remain queued for retries, so cleanup may finish after the retention point.</p>
            <p>Other content and community records remain until deleted by you, an authorized moderator, a parent resource, or account erasure, subject to safety, legal-hold, and technical-cleanup exceptions. A self-service account deletion is scheduled for completion after a 30-day grace period. Provider logs, backups, replicas, caches, and orphaned objects have separate behavior that has not been deployment-verified. Other users may have saved copies before deletion.</p>
          </section>

          <section id="privacy-rights">
            <h2>7. Your choices and rights</h2>
            <p>You can change available profile, privacy, notification, activity, friend-request, stream-preview, and integration settings; decline device permissions; disable automatic game activity; disconnect Steam; delete content where supported; download an account-data export in account settings (messages you sent and received, reactions, reports you filed, and masked push-token details); and request account deletion in the app.</p>
            <p>Depending on your location, you may have rights to access, correct, delete, restrict, object, port, withdraw consent, opt out of sale or sharing for cross-context behavioral advertising, receive service without unlawful discrimination, and complain to a regulator. For a request not handled by account controls, email <a href="mailto:security@example.invalid?subject=Privacy%20request">security@example.invalid</a> with “Privacy request” and the right you want to exercise. We may verify account control and apply legal exceptions. We aim to respond within applicable legal deadlines; the controller and countries where those rights apply must be confirmed before publication. A second California request method will be published before a CCPA-covered launch if required.</p>
          </section>

          <section id="privacy-children">
            <h2>8. Children and international transfers</h2>
            <p>New registrations currently require applicants to be at least 18. This is a conservative product rule while launch countries and their requirements remain undecided, not a claim that 18 is the legal minimum everywhere. Existing accounts are not retroactively required by this signup rule to re-confirm age. Registration derives an age band and eligibility status from a self-attested birth date; the exact date is not stored. A higher local minimum age or parental-authorization rule still applies.</p>
            {/* LEGAL REVIEW REQUIRED: confirm transfer mechanisms (Cloudflare DPA/SCCs, Data Privacy Framework status, UK Addendum / Swiss amendments) before publication. */}
            <p>DeCave runs on Cloudflare's global network, so your information can be processed in countries other than yours, including the United States. Where GDPR, UK GDPR, or Swiss law applies and data goes to a country without an adequacy decision, we rely on the European Commission's Standard Contractual Clauses in our providers' data processing terms and, for certified US providers, the EU-US Data Privacy Framework and its UK and Swiss extensions. Contact us to request details of the safeguards that apply.</p>
          </section>

          <section id="privacy-contact">
            <h2>9. Security, changes, and contact</h2>
            <p>We use measures such as encrypted transport, password and token hashing, access controls, rate limiting, owner MFA, security logging, account-erasure tooling, and client-side encryption of safety-report evidence. No system is completely secure, so protect your password and devices.</p>
            {/* LEGAL REVIEW REQUIRED: confirm incident-response procedure, competent supervisory authority, and per-country notification duties before publication. */}
            <p>If a personal data breach occurs, we will contain and record it. Where GDPR or UK GDPR requires, we will notify the competent supervisory authority without undue delay and, where feasible, within 72 hours, and notify affected users without undue delay when the breach is likely to result in a high risk to them.</p>
            <p>We may update this notice when the Service, law, providers, or data practices change. We will update the effective date and provide any additional notice or consent required by law.</p>
            <p><strong>Privacy and security:</strong> <a href="mailto:security@example.invalid">security@example.invalid</a><br /><strong>Controller:</strong> [LEGAL ENTITY NAME]<br /><strong>Address:</strong> [CONTROLLER ADDRESS]</p>
          </section>

          <p className="article-footnote">Do not include passwords, private keys, unredacted conversations, or unnecessary personal information in a privacy or security email.</p>
        </article>
      </div>
    </InfoLayout>
  );
}

// Publication status: Draft.
function TermsPage() {
  return (
    <InfoLayout
      page="terms"
      eyebrow="Terms of service"
      title={<>Use the cave.<br /><span>Keep it playable.</span></>}
      lead="The rules for accounts, content, communities, safety, release boundaries, and the current alpha service."
      updated="Effective October 5, 2026"
    >
      <div className="disclosure-banner">
        <ShieldAlert size={19} />
        <span><strong>Implementation draft:</strong> replace the legal entity, address, governing law, liability cap, arbitration, copyright-agent, and market-specific terms with counsel-approved details before publication.</span>
      </div>
      <div className="info-columns">
        <aside className="info-aside">
          <span>On this page</span>
          <a href="#terms-agreement">Agreement</a>
          <a href="#terms-use">Acceptable use</a>
          <a href="#terms-content">Content &amp; communities</a>
          <a href="#terms-encryption">Encryption</a>
          <a href="#terms-safety">Safety &amp; enforcement</a>
          <a href="#terms-ip">Intellectual property</a>
          <a href="#terms-ending">Ending access</a>
          <a href="#terms-contact">Contact</a>
        </aside>
        <article className="policy-article">
          <section id="terms-agreement">
            <h2>1. Agreement, eligibility, and accounts</h2>
            <p>These Terms are an agreement between you and <strong>[LEGAL ENTITY NAME]</strong> governing your use of DeCave. By creating an account, accessing, or using the Service, you agree to these Terms and the <a href="/privacy">Privacy Policy</a>. New account registration requires explicit acceptance of the current versions, recorded with the acceptance time. The current Terms and Privacy versions are 2026-10. If you do not agree, do not use the Service.</p>
            <p>New registrations currently require applicants to be at least 18. This is a conservative product rule while launch countries and their requirements remain undecided, not a claim that 18 is the legal minimum everywhere. Existing accounts are not retroactively required by this signup rule to re-confirm age. A higher local minimum age or parental-authorization rule still applies. Registration derives an age band and eligibility status from a self-attested birth date; the exact date is not stored. Keep your account information accurate, protect your password and recovery materials, and do not use another person’s account without permission. We may require email verification, human verification, device approval, or a password reset to protect the Service.</p>
          </section>

          <section id="terms-release">
            <h2>2. The current release</h2>
            <p>DeCave provides Hubs, rooms, friends, messages, voice, video, screen sharing, discovery, safety tools, and related features. The current product is alpha or pre-release: access, downloads, messaging, and calls may be paused or restricted while security review, retention procedures, or other release gates are completed. Features may change, be limited by platform, or be removed.</p>
          </section>

          <section id="terms-use">
            <h2>3. Acceptable use</h2>
            <p>You must use DeCave lawfully and follow the Community Guidelines and Hub-specific rules. You must not:</p>
            <div className="data-table">
              <div><strong>Abuse or exploitation</strong><span>Harass, threaten, stalk, bully, groom, exploit, doxx, or target another person; publish hate speech, sexual exploitation, child sexual abuse material, credible threats, or non-consensual intimate media.</span></div>
              <div><strong>Fraud or impersonation</strong><span>Impersonate, scam, phish, harvest credentials, misrepresent affiliation, or distribute spam, malware, ransomware, or malicious links.</span></div>
              <div><strong>Security interference</strong><span>Probe, scrape, overload, reverse engineer, bypass, or interfere with accounts, rate limits, safety controls, security boundaries, or infrastructure, except where law and written authorization allow it.</span></div>
              <div><strong>Rights and privacy</strong><span>Infringe intellectual-property, privacy, publicity, confidentiality, or other rights, or expose another person’s personal information without a lawful reason and permission.</span></div>
              <div><strong>Unsafe use</strong><span>Use the Service for emergency communications, life-critical control, professional advice, or a situation where delay or failure could cause serious harm.</span></div>
            </div>
            <p>You are responsible for the content you submit and for the consequences of sharing it. Do not upload passwords, private keys, government IDs, payment data, or unnecessary sensitive information.</p>
          </section>

          <section id="terms-content">
            <h2>4. User content and communities</h2>
            <p>You retain ownership of content you create. You grant DeCave a limited, non-exclusive, worldwide, royalty-free license to host, store, reproduce, format, transmit, display, and technically process that content only as needed to operate, secure, moderate, support, and improve the Service and provide the feature you selected. The license ends when content is deleted, except for permitted or required copies in backups, legal holds, or moderation records. Messages and other account content are removed from active systems when erasure completes; recipients may retain copies they already received.</p>
            <p>Public profiles, public Hubs, invitations, messages, calls, and screen sharing are visible to the recipients you choose. Community owners and moderators may set local rules, remove content, manage roles, and restrict members. You must have the right to submit content about other people.</p>
          </section>

          <section id="terms-encryption">
            <h2>5. Messages, calls, and encryption</h2>
            <p>TLS protects network traffic to the Service. Voice, camera, and screen-sharing media is carried through a relay provider (Cloudflare TURN) rather than direct peer-to-peer connections; if the relay is unavailable, voice and calls may be temporarily unavailable. DeCave stores and processes readable message content and attachments to deliver and moderate them. DeCave also processes account, participant, group, routing, timing, size, delivery, IP/network, and signalling metadata. Recipients and capture tools can copy or record what they receive.</p>
          </section>

          <section id="terms-safety">
            <h2>6. Safety, reports, and enforcement</h2>
            <p>Use blocking, muting, reporting, and leaving controls where available. Reports should be truthful and limited to relevant context. We may investigate, preserve evidence, remove content, revoke devices, require a password reset, suspend or terminate accounts, limit a Hub, or contact authorities when reasonably necessary for safety, security, legal compliance, or the Service.</p>
            <p>We may act without advance notice where needed to prevent harm or preserve evidence. We do not promise to find every violation or produce a particular report outcome. If an appeal process is offered, follow the instructions included with the decision.</p>
          </section>

          <section id="terms-third-party">
            <h2>7. Optional integrations</h2>
            <p>A Hub owner can choose to import a public Discord server template; DeCave does not connect a Discord account or import private messages. Steam supports account linking and public profile/activity data. GIPHY media is served through a DeCave proxy. Mobile push uses Expo’s push service, which routes delivery through APNs or FCM; Apple CallKit can show and control an active voice room in iOS system call UI. Cloudflare, app stores, operating systems, game platforms, and other services also provide infrastructure, transport, or distribution features. Their own terms and privacy notices apply. DeCave does not control their availability, accuracy, security, or moderation.</p>
          </section>

          <section id="terms-ip">
            <h2>8. DeCave intellectual property</h2>
            <p>The Service, software, visual design, logos, names, documentation, and other DeCave materials belong to DeCave or its licensors. Subject to these Terms, we grant you a limited, revocable, non-exclusive, non-transferable license for personal or authorized community use. Do not copy, sell, sublicense, modify, distribute, or create derivative works from DeCave materials except as allowed by law or in writing.</p>
            <p>Rights complaints can be sent to <a href="mailto:security@example.invalid">security@example.invalid</a>. A jurisdiction-specific copyright-agent process will be added before relying on one.</p>
          </section>

          <section id="terms-ending">
            <h2>9. Privacy, fees, and ending access</h2>
            <p>The <a href="/privacy">Privacy Policy</a> explains data collection, security, retention, deletion, and rights. The current core Service has no stated subscription fee. Paid features, if introduced, will show pricing and additional terms before a charge.</p>
            <p>You may stop using DeCave and request account deletion in the app. A self-service deletion request is scheduled for completion after a 30-day grace period; an authorized administrator can execute an immediate erasure. We may suspend or terminate access for violations, safety or security risk, legal requirements, extended inactivity, or operational reasons. Account erasure removes channel messages authored by the account and direct-message rows involving it, and deletes tracked account-owned attachments and Hub assets. Other users may have saved copies. Report evidence under legal hold may remain; non-held report evidence is deleted. Backups and provider logs follow their actual expiry periods.</p>
          </section>

          <section id="terms-disclaimers">
            <h2>10. Disclaimers and liability</h2>
            <p>To the maximum extent permitted by law, the Service is provided “as is” and “as available.” DeCave does not promise uninterrupted availability, error-free operation, delivery, recoverability, privacy, preservation, or that moderation will identify every harmful act. We disclaim warranties that cannot lawfully be excluded only to the extent allowed by law.</p>
            <p>To the maximum extent permitted by law, DeCave and its owners, staff, contractors, providers, and licensors will not be liable for indirect, special, consequential, exemplary, or punitive damages, or lost profits, data, goodwill, or revenue. Total liability will not exceed the greater of what you paid us for the Service in the prior 12 months or <strong>[INSERT CAP AMOUNT]</strong>. Non-waivable consumer rights and liability that cannot legally be limited are not affected.</p>
          </section>

          <section id="terms-disputes">
            <h2>11. Disputes and governing law</h2>
            <p><strong>Governing law and courts:</strong> [GOVERNING LAW AND COURTS]. The final informal-resolution, arbitration, class-action, and market-specific consumer terms must be completed after legal review. Contact <a href="mailto:security@example.invalid">security@example.invalid</a> first with a clear description of a dispute; this does not remove a non-waivable right to contact a regulator or seek urgent relief.</p>
          </section>

          <section id="terms-contact">
            <h2>12. Changes and contact</h2>
            <p>We may update these Terms when the Service or law changes. We will update the effective date and provide additional notice or consent where required. If you continue using the Service after the effective date, the updated Terms apply to future use. If you do not agree, stop using the Service and request deletion.</p>
            <p><strong>General support:</strong> <a href="mailto:support@de-cave.com">support@de-cave.com</a><br /><strong>Legal, privacy, and security:</strong> <a href="mailto:security@example.invalid">security@example.invalid</a><br /><strong>Legal entity:</strong> [LEGAL ENTITY NAME]<br /><strong>Address:</strong> [CONTROLLER/CONTRACTING ADDRESS]</p>
          </section>

          <p className="article-footnote">These Terms are an implementation draft, not legal advice. Complete the bracketed fields and obtain jurisdiction-specific review before treating them as a final contract.</p>
        </article>
      </div>
    </InfoLayout>
  );
}


type ThemeKey = "nebula" | "signal" | "daylight";

type ThemeOption = {
  id: ThemeKey;
  label: string;
  subtitle: string;
  description: string;
};

type IconComponent = React.ComponentType<any>;

const themeOptions: ThemeOption[] = [
  {
    id: "nebula",
    label: "Nebula",
    subtitle: "Immersive / product-led",
    description: "A deep-space canvas with bright signal colors and generous, cinematic surfaces.",
  },
  {
    id: "signal",
    label: "Signal",
    subtitle: "Focused / status-first",
    description: "A sharper operator view that makes releases, security and community updates scan fast.",
  },
  {
    id: "daylight",
    label: "Daylight",
    subtitle: "Open / community-first",
    description: "A warmer, lighter direction that feels welcoming without losing the DeCave spectrum.",
  },
];

const featureCards: Array<{
  icon: IconComponent;
  label: string;
  title: string;
  copy: string;
  tone: string;
}> = [
  {
    icon: Mic2,
    label: "Voice rooms",
    title: "Low-latency voice that stays present.",
    copy: "Jump into focused voice rooms with responsive controls, clear participant states and a room that stays visible while you play.",
    tone: "violet",
  },
  {
    icon: MonitorUp,
    label: "Screen sharing",
    title: "Share in up to 2K at 60 FPS.",
    copy: "Show the play clearly with high-motion screen sharing, quality profiles and a gallery that makes streams easy to follow.",
    tone: "cyan",
  },
  {
    icon: Users,
    label: "Hubs & friends",
    title: "Build a Hub around your people.",
    copy: "Create text rooms, voice rooms and forums inside Hubs, then keep friends, DMs and Active Now close at hand.",
    tone: "lime",
  },
  {
    icon: Gamepad2,
    label: "Squad Finder",
    title: "Find the right squad faster.",
    copy: "Match with players by game, role and vibe so you can fill a team without leaving your community space.",
    tone: "violet",
  },
  {
    icon: Layers3,
    label: "Home dashboard",
    title: "Make Home work your way.",
    copy: "Customize your dashboard with the widgets, hubs, friends and activity that matter most to your next session.",
    tone: "cyan",
  },
  {
    icon: LockKeyhole,
    label: "Trust layer",
    title: "Safety tools built in.",
    copy: "Reports, moderation cases, blocking, age checks and owner MFA keep communities manageable. TLS protects web traffic; DeCave stores readable messages for delivery and moderation.",
    tone: "orange",
  },
];

const latestUpdates = [
  {
    version: "0.1.19",
    date: "30 Aug 2026",
    title: "Voice controls & Hub alignment",
    copy: "Wide Hub switcher tiles, aligned profile controls and translucent voice actions are live across the web and Windows product surface.",
    status: "Live",
    tone: "live",
  },
  {
    version: "0.1.17",
    date: "30 Aug 2026",
    title: "Gallery voice & compact soundboard",
    copy: "Equal participant cards, responsive screen-share gallery, compact soundboard controls and matched bottom-toolbar actions.",
    status: "Live",
    tone: "live",
  },
  {
    version: "0.1.15",
    date: "30 Aug 2026",
    title: "Screen-sharing stability pass",
    copy: "Codec preferences now land before negotiation, 30 FPS favors readable UI, and higher-motion profiles remain explicit choices.",
    status: "Live",
    tone: "live",
  },
  {
    version: "0.1.14",
    date: "30 Aug 2026",
    title: "Voice / ICE hardening",
    copy: "Bounded candidate queues, remote-description guards and recovery work reduce the asymmetric-hearing failure modes found in review.",
    status: "Live",
    tone: "live",
  },
];

const roadmapItems = [
  {
    number: "01",
    state: "Shipped",
    title: "Make the product feel ready",
    copy: "Voice gallery, Active Now, screen-share quality profiles, draft preservation, remembered Hub selection and the 0.1.x desktop release line.",
    meta: "Current line · 0.1.34",
    icon: Zap,
    tone: "complete",
  },
  {
    number: "02",
    state: "In progress",
    title: "Ship the next desktop release",
    copy: "Windows Authenticode signing, a refreshed auto-update feed and the history, reliability and error-handling fixes from the latest review.",
    meta: "Desktop first",
    icon: ShieldCheck,
    tone: "active",
  },
  {
    number: "03",
    state: "Next",
    title: "Bring mobile up to date",
    copy: "A new Android and iOS build with the current sign-in, older-message history and 1:1 calls on the same path as desktop.",
    meta: "Android and iOS",
    icon: Smartphone,
    tone: "queued",
  },
  {
    number: "04",
    state: "Later",
    title: "Bigger rooms",
    copy: "Investigate an SFU/media-server path for larger voice and screen-share rooms beyond the current peer mesh.",
    meta: "Scale needs a new media path",
    icon: LockKeyhole,
    tone: "later",
  },
];

const faqItems = [
  {
    question: "Can I download DeCave right now?",
    answer:
      "Yes. The DeCave web app is available now and can be used from your browser. Desktop apps are available for Windows and for Mac (Apple silicon and Intel, signed and notarized by Apple).",
  },
  {
    question: "How are messages protected?",
    answer:
      "TLS protects web traffic to Cloudflare, and WebRTC encrypts media in transit. DeCave stores message text and attachments in readable form so it can deliver, sync and moderate them.",
  },
  {
    question: "What is the current screen-sharing recommendation?",
    answer:
      "Start with Auto, which now uses a steadier 1080p30 / 8 Mbps baseline. Use 1080p60 or 1440p60 only when the sender has enough upload and GPU headroom. The current peer mesh is optimized for small rooms; larger rooms need a future SFU/media-server path.",
  },
  {
    question: "Where should I report a security issue?",
    answer:
      "Email security@example.invalid with a short description and safe reproduction details. Do not include passwords, private keys, sensitive conversations or unredacted files. For product questions, use the official DeCave Community Hub when access is available.",
  },
  {
    question: "What should I include in a support request?",
    answer:
      "Include the product version, platform, browser or Windows runtime, the room type, exact steps to reproduce and what you expected to happen. Redact tokens, personal data, message content and file attachments before sending diagnostics.",
  },
];

const officialLinks: Array<{
  label: string;
  detail: string;
  href: string;
  icon: IconComponent;
  external?: boolean;
}> = [
  {
    label: "DeCave Community",
    detail: "Official in-app community hub",
    href: "/roadmap",
    icon: Users,
    external: true,
  },
  {
    label: "Windows release feed",
    detail: "Current updater manifest",
    href: "https://downloads.de-cave.com/updates/windows/latest.yml",
    icon: Download,
    external: true,
  },
  {
    label: "Android operator APK path",
    detail: "Existing link preserved; APK not in this scope",
    href: ANDROID_OPERATOR_DOWNLOAD_URL,
    icon: Smartphone,
  },
  {
    label: "Security contact",
    detail: "security@example.invalid",
    href: "mailto:security@example.invalid",
    icon: ShieldAlert,
  },
];

const socialChannels: Array<{ label: string; icon: IconComponent }> = [
  { label: "Discord", icon: MessageCircle },
  { label: "X / Twitter", icon: Radio },
  { label: "Instagram", icon: Globe2 },
  { label: "TikTok", icon: Smartphone },
];

function useSiteTheme(): [ThemeKey, (theme: ThemeKey) => void] {
  const [theme, setTheme] = useState<ThemeKey>("nebula");

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("decave-site-theme");
    if (savedTheme === "nebula" || savedTheme === "signal" || savedTheme === "daylight") {
      setTheme(savedTheme);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("decave-site-theme", theme);
    document.documentElement.style.colorScheme = theme === "daylight" ? "light" : "dark";
  }, [theme]);

  return [theme, setTheme];
}

function Brand({ href = "/" }: { href?: string }) {
  return (
    <a className="brand" href={href} aria-label="DeCave home">
      <img src="/brand/decave-mark.png" alt="" aria-hidden="true" className="brand-mark" />
      <span className="brand-copy">
        <span className="brand-word"><span>De</span><strong>C</strong><span>ave</span></span>
        <span className="brand-caption">Play together</span>
      </span>
    </a>
  );
}

function ExternalIcon({ external = false }: { external?: boolean }) {
  return external ? <ExternalLink size={14} aria-hidden="true" /> : <ArrowUpRight size={14} aria-hidden="true" />;
}

function StatusBadge({ children, tone = "live" }: { children: React.ReactNode; tone?: string }) {
  return (
    <span className={`status-badge ${tone}`}>
      <span className="status-badge-dot" aria-hidden="true" />
      {children}
    </span>
  );
}

function SiteNav({ page = "home" }: { page?: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const homeTarget = (hash: string) => page === "home" ? hash : `/${hash}`;
  const links = [
    { label: "Product", href: homeTarget("#features") },
    { label: "Roadmap", href: page === "home" ? "#roadmap" : "/roadmap" },
    { label: "Community", href: page === "home" ? "#community" : "/guidelines" },
  ];

  return (
    <header className="site-nav">
      <div className="nav-inner">
        <Brand href={page === "home" ? "#top" : "/"} />
        <nav className="desktop-nav" aria-label="Primary navigation">
          {links.map((link) => <a href={link.href} key={link.label}>{link.label}</a>)}
        </nav>
        <div className="nav-actions">
          <a className="nav-help" href={page === "home" ? "#support" : "/help"}>Help center</a>
          <a className="nav-cta" href="/roadmap">
            Release boundary <ArrowRight size={15} aria-hidden="true" />
          </a>
          <button
            className="menu-toggle"
            type="button"
            aria-expanded={isOpen}
            aria-controls="mobile-navigation"
            aria-label={isOpen ? "Close navigation" : "Open navigation"}
            onClick={() => setIsOpen((open) => !open)}
          >
            {isOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>
      {isOpen && (
        <nav className="mobile-nav" id="mobile-navigation" aria-label="Mobile navigation">
          {links.map((link) => <a href={link.href} key={link.label} onClick={() => setIsOpen(false)}>{link.label}<ArrowUpRight size={15} /></a>)}
          <a href={page === "home" ? "#support" : "/help"} onClick={() => setIsOpen(false)}>Help center<ArrowUpRight size={15} /></a>
          <a href={page === "home" ? "#trust" : "/privacy"} onClick={() => setIsOpen(false)}>Privacy & trust<ArrowUpRight size={15} /></a>
        </nav>
      )}
    </header>
  );
}

function ThemePicker({ theme, onChange }: { theme: ThemeKey; onChange: (theme: ThemeKey) => void }) {
  return (
    <section className="direction-section" id="choose" aria-labelledby="direction-heading">
      <div className="section-heading direction-heading">
        <div>
          <p className="eyebrow">Choose a direction</p>
          <h2 id="direction-heading">Three ways to make<br /><span>the cave feel like home.</span></h2>
        </div>
        <p className="section-intro">These are live visual directions, not static boards. Tap a card and the whole site updates so you can compare the mood with the same product story.</p>
      </div>
      <div className="theme-picker-grid">
        {themeOptions.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`theme-card ${theme === option.id ? "selected" : ""}`}
            aria-pressed={theme === option.id}
            onClick={() => onChange(option.id)}
          >
            <span className={`theme-card-preview preview-${option.id}`} aria-hidden="true">
              <span className="mini-preview-window">
                <span className="mini-preview-top"><i /><i /><i /></span>
                <span className="mini-preview-body"><i /><b /><em /></span>
              </span>
            </span>
            <span className="theme-card-footer">
              <span>
                <strong>{option.label}</strong>
                <small>{option.subtitle}</small>
              </span>
              <span className="theme-card-check">{theme === option.id ? <Check size={15} /> : <ArrowUpRight size={15} />}</span>
            </span>
            <span className="theme-card-description">{option.description}</span>
          </button>
        ))}
      </div>
      <div className="direction-note"><Sparkles size={16} /><span>Currently previewing <strong>{themeOptions.find((option) => option.id === theme)?.label}</strong>. Your preference is saved on this device.</span></div>
    </section>
  );
}

function ProductPreview() {
  const messages = [
    { name: "Player 01", initials: "P", text: "Queue pops in two. Voice?", color: "blue" },
    { name: "Player 02", initials: "P", text: "Already in Game Voice 👀", color: "violet" },
    { name: "Player 03", initials: "P", text: "Saving a slot for the comeback.", color: "orange" },
  ];

  return (
    <div className="product-preview-wrap" aria-label="Sanitized preview of the DeCave product interface">
      <div className="product-preview-glow" aria-hidden="true" />
      <div className="product-window">
        <div className="product-topbar">
          <div className="product-window-dots"><i /><i /><i /></div>
          <div className="product-window-title"><span className="product-mini-mark">DC</span><span>DeCave</span><small>/ Team Hub</small></div>
          <StatusBadge>In session</StatusBadge>
        </div>
        <div className="product-body">
          <aside className="product-rail" aria-label="Product navigation preview">
            <div className="rail-logo">DC</div>
            <div className="rail-item active"><Gamepad2 size={16} /><span>Home</span></div>
            <div className="rail-item"><MessageCircle size={16} /><span>DMs</span></div>
            <div className="rail-item"><Users size={16} /><span>Friends</span></div>
            <div className="rail-item"><Search size={16} /><span>Discover</span></div>
            <div className="rail-spacer" />
            <div className="rail-item"><Layers3 size={16} /><span>More</span></div>
          </aside>
          <aside className="product-rooms">
            <div className="preview-hub-head"><span className="hub-avatar">TH</span><span><strong>Team Hub</strong><small>8 members · 3 online</small></span><ChevronDown size={14} /></div>
            <span className="preview-label">Text rooms</span>
            <div className="preview-room active"><MessageCircle size={13} /> team-room</div>
            <div className="preview-room"><span className="room-dot orange" /> highlights</div>
            <div className="preview-room"><span className="room-dot violet" /> loadout-lab</div>
            <span className="preview-label voice-label">Voice rooms</span>
            <div className="preview-room"><Volume2 size={13} /> Lobby Voice</div>
            <div className="preview-room active-voice"><Volume2 size={13} /> Game Voice <span className="voice-count">4</span></div>
            <div className="room-footer"><span className="preview-avatar small blue">P</span><span><strong>Player 04</strong><small>Online</small></span><span className="room-footer-dot" /></div>
          </aside>
          <main className="product-chat">
            <div className="chat-header"><div><span className="chat-kicker">TEXT ROOM</span><h3># team-room</h3></div><div className="chat-header-actions"><span>Active now</span><span>•••</span></div></div>
            <div className="chat-messages">
              <div className="chat-welcome"><span className="welcome-icon"><Sparkles size={17} /></span><strong>Welcome to team-room</strong><small>Plan the next round with your people.</small></div>
              {messages.map((message, index) => (
                <div className="chat-message" key={message.name}>
                  <span className={`preview-avatar ${message.color}`}>{message.initials}</span>
                  <span><span className="message-meta"><strong>{message.name}</strong><small>9:4{index + 1} PM</small></span><p>{message.text}</p></span>
                </div>
              ))}
            </div>
            <div className="chat-composer"><span>Message #team-room</span><span className="composer-actions"><span>+</span><span>☺</span><span>↑</span></span></div>
          </main>
          <aside className="product-now">
            <div className="now-heading"><span>Active now</span><small>3 online</small></div>
            <div className="activity-card live"><span className="activity-art"><span className="activity-scan" /></span><span className="activity-copy"><strong>Player 01</strong><small>Game Voice</small></span><span className="activity-tag">VOICE</span></div>
            <div className="activity-card live"><span className="activity-art purple"><span className="activity-scan" /></span><span className="activity-copy"><strong>Player 02</strong><small>Sharing a screen</small></span><span className="activity-tag">LIVE</span></div>
            <span className="preview-label friends-label">Friends</span>
            <div className="friend-preview"><span className="preview-avatar tiny orange">P</span><span><strong>Player 03</strong><small>Queueing ranked</small></span><i className="online-dot" /></div>
            <div className="friend-preview"><span className="preview-avatar tiny green">P</span><span><strong>Player 04</strong><small>Taking a break</small></span><i className="online-dot idle" /></div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function PreviewGallery() {
  return (
    <section className="content-section preview-gallery-section" id="screenshots" aria-labelledby="screenshots-heading">
      <div className="section-heading split-heading">
        <div><p className="eyebrow">Current UI</p><h2 id="screenshots-heading">See the product<br /><span>as it is today.</span></h2></div>
        <p className="section-intro">These are direct captures from the current DeCave app. Names, IDs, private messages, and security-sensitive details have been replaced.</p>
      </div>
      <div className="preview-gallery-grid">
        <figure className="preview-gallery-card"><img src="/screens/decave-hero-alpha-enhanced.png" alt="Crisp DeCave product overview showing a team hub, text room, voice room, and friends" /><figcaption><strong>DeCave, in one frame</strong><span>High-resolution product overview of the alpha experience.</span></figcaption></figure>
        <figure className="preview-gallery-card"><img src="/screens/decave-live-dm-sanitized.png" alt="Sanitized live Direct Messages view with neutral placeholder names and messages" /><figcaption><strong>Direct messages</strong><span>Live conversation layout with private content replaced.</span></figcaption></figure>
        <figure className="preview-gallery-card"><img src="/screens/decave-live-squad-sanitized.png" alt="Sanitized Squad Finder matchmaking dialog" /><figcaption><strong>Squad Finder</strong><span>Match by game, platform, language, region, and microphone.</span></figcaption></figure>
        <figure className="preview-gallery-card"><img src="/screens/decave-live-friends-sanitized.png" alt="Sanitized Friends tab showing online and offline friends" /><figcaption><strong>Friends</strong><span>Friend discovery and presence with privacy-safe names.</span></figcaption></figure>
        <figure className="preview-gallery-card"><img src="/screens/decave-live-hub-sanitized.png" alt="Sanitized DeCave hub text room" /><figcaption><strong>Hubs and rooms</strong><span>Text, forums, and voice spaces in one community hub.</span></figcaption></figure>
        <figure className="preview-gallery-card"><img src="/screens/decave-live-voice-sanitized.png" alt="Sanitized voice room with screen sharing" /><figcaption><strong>Voice and screen sharing</strong><span>Voice presence and screen sharing in a shared room.</span></figcaption></figure>
        <figure className="preview-gallery-card"><img src="/screens/decave-live-home-sanitized.png" alt="Sanitized customizable DeCave home dashboard" /><figcaption><strong>Home dashboard</strong><span>A customizable view of your hubs, friends, rooms, and activity.</span></figcaption></figure>
      </div>
      <div className="preview-safety-note"><ShieldCheck size={16} /><span>Names, account IDs, private messages, and security-sensitive details are redacted.</span></div>
    </section>
  );
}

function PublicPreviewPage() {
  return (
    <div className="site public-preview-page theme-nebula">
      <header className="public-preview-bar"><Brand /><span>Public UI preview · private details hidden</span></header>
      <main className="public-preview-main">
        <div className="public-preview-heading"><p className="eyebrow">Sanitized product view</p><h1>A room for the<br /><span>next round.</span></h1><p>Placeholder content keeps this preview safe to share.</p></div>
        <ProductPreview />
      </main>
    </div>
  );
}

function Hero() {
  return (
    <section className="hero-section">
      <div className="hero-orb hero-orb-one" aria-hidden="true" />
      <div className="hero-orb hero-orb-two" aria-hidden="true" />
      <div className="hero-grid">
        <div className="hero-copy">
          <div className="hero-kicker"><span className="pulse-dot" /> Product status · 30 Aug 2026</div>
          <h1>Put the whole<br /><span>session</span> in one place.</h1>
          <p className="hero-lead">DeCave is a gaming-first home for voice, Hubs, friends and screen sharing—designed to keep the people and the play in the same frame.</p>
          <div className="hero-actions">
          <a className="button-primary" href={WINDOWS_OPERATOR_DOWNLOAD_URL}>Download Windows <ArrowRight size={16} /></a>
            <a className="button-primary" href={MAC_APPLE_SILICON_DOWNLOAD_URL}>Download Mac <ArrowRight size={16} /></a>
            <a className="button-secondary" href={ANDROID_OPERATOR_DOWNLOAD_URL}>Android release path <ArrowRight size={16} /></a>
          </div>
          <div className="hero-status-row"><StatusBadge>Current release</StatusBadge><span>Windows installer · Mac for Apple silicon (<a href={MAC_INTEL_DOWNLOAD_URL}>Intel</a>) · Android release path unchanged</span><a href={OPERATOR_RELEASE_METADATA_URL}>Read artifact details <ArrowUpRight size={13} /></a></div>
        </div>
        <ProductPreview />
      </div>
    </section>
  );
}

function FeatureSection() {
  return (
    <section className="content-section" id="features" aria-labelledby="features-heading">
      <div className="section-heading split-heading"><div><p className="eyebrow">The product</p><h2 id="features-heading">The good stuff stays<br /><span>close at hand.</span></h2></div><p className="section-intro">Everything here is shaped around the small group you are actually trying to hear, see and play with.</p></div>
      <div className="feature-grid">
        {featureCards.map((feature) => { const Icon = feature.icon; return <article className={`feature-card ${feature.tone}`} key={feature.title}><div className="feature-icon"><Icon size={20} /></div><span className="feature-label">{feature.label}</span><h3>{feature.title}</h3><p>{feature.copy}</p><a href="/roadmap">See the product boundary <ArrowUpRight size={14} /></a></article>; })}
      </div>
    </section>
  );
}

function ReleaseArchive() {
  return (
    <section className="content-section updates-section" id="updates" aria-labelledby="updates-heading">
      <div className="section-heading split-heading"><div><p className="eyebrow">Release archive</p><h2 id="updates-heading">A cleaner room,<br /><span>release by release.</span></h2></div><div className="heading-side-note"><p>Recent product passes and the full release path.</p><a href="/roadmap">Read the roadmap <ArrowUpRight size={14} /></a></div></div>
      <div className="updates-layout">
        <article className="current-release-card"><div className="release-card-top"><span className="release-icon"><Rocket size={19} /></span><StatusBadge>Desktop</StatusBadge></div><p className="eyebrow">Current release</p><h3>{CURRENT_OPERATOR_VERSION}</h3><p className="release-card-title">The current Windows installer and auto-update feed.</p><p>This build is not yet Authenticode-signed, so Windows may show a SmartScreen prompt on first install.</p><div className="release-list"><span><Check size={14} /> Windows installer + updater feed</span><span><Clock3 size={14} /> Android path preserved; APK not included in this scope</span></div><a className="button-secondary small" href={OPERATOR_RELEASE_METADATA_URL}>View artifact details <ExternalLink size={14} /></a></article>
        <div className="updates-list">{latestUpdates.slice(0, 3).map((update, index) => <article className={`update-row ${index === 0 ? "featured" : ""}`} key={update.version}><div className="update-version"><strong>{update.version}</strong><span>{update.date}</span></div><div className="update-copy"><div><h3>{update.title}</h3><StatusBadge tone={update.tone}>{update.status}</StatusBadge></div><p>{update.copy}</p></div><ArrowUpRight className="update-arrow" size={16} /></article>)}</div>
      </div>
    </section>
  );
}

function RoadmapPreview() {
  return (
    <section className="content-section roadmap-section" id="roadmap" aria-labelledby="roadmap-heading">
      <div className="section-heading split-heading"><div><p className="eyebrow">Roadmap</p><h2 id="roadmap-heading">Ship the fun.<br /><span>Earn the trust.</span></h2></div><div className="heading-side-note"><p>The order matters: product polish continues, but public security claims only move when the evidence does.</p><a href="/roadmap">Open the detailed roadmap <ArrowUpRight size={14} /></a></div></div>
      <div className="roadmap-track">{roadmapItems.map((item, index) => { const Icon = item.icon; return <article className={`roadmap-card ${item.tone}`} key={item.number}><div className="roadmap-card-top"><span className="roadmap-number">{item.number}</span><span className="roadmap-state">{item.state}</span></div><div className="roadmap-icon"><Icon size={18} /></div><h3>{item.title}</h3><p>{item.copy}</p><span className="roadmap-meta">{item.meta}</span>{index < roadmapItems.length - 1 && <span className="roadmap-connector" aria-hidden="true" />}</article>; })}</div>
    </section>
  );
}

function SupportSection() {
  return (
    <section className="content-section support-section" id="community" aria-labelledby="support-heading">
      <div className="section-heading split-heading"><div><p className="eyebrow">Stay close</p><h2 id="support-heading">Good docs make<br /><span>good communities.</span></h2></div><p className="section-intro">Find the rules, the current disclosure, the release path and a safe way to ask for help.</p></div>
      <div className="support-grid">
        <a className="support-card accent-violet" href="/privacy"><span className="support-card-icon"><LockKeyhole size={18} /></span><span className="support-card-label">Trust</span><h3>Privacy policy & data use</h3><p>What DeCave collects, stores, shares, and still needs to verify before public launch.</p><span className="support-card-link">Read the policy <ArrowUpRight size={14} /></span></a>
        <a className="support-card accent-cyan" href="/guidelines"><span className="support-card-icon"><Users size={18} /></span><span className="support-card-label">Community</span><h3>Community guidelines</h3><p>The short version of how to make Hubs welcoming, playable and safe for everyone.</p><span className="support-card-link">Read the guidelines <ArrowUpRight size={14} /></span></a>
        <a className="support-card accent-orange" href="/help"><span className="support-card-icon"><CircleHelp size={18} /></span><span className="support-card-label">Help center</span><h3>Answers before you ask</h3><p>Access, release status, screen sharing, security reports and support-request basics.</p><span className="support-card-link">Open help center <ArrowUpRight size={14} /></span></a>
      </div>
    </section>
  );
}

function OfficialChannels() {
  return (
    <section className="channels-section" id="support" aria-labelledby="channels-heading">
      <div className="channels-heading"><p className="eyebrow">Official channels</p><h2 id="channels-heading">One source of truth.<br /><span>No mystery handles.</span></h2><p>Use the links below for the current app, releases and security contact. Public social handles will be added here once they are officially published.</p></div>
      <div className="channels-content"><div className="official-link-grid">{officialLinks.map((link) => { const Icon = link.icon; return <a className="official-link" href={link.href} key={link.label} target={link.external ? "_blank" : undefined} rel={link.external ? "noreferrer" : undefined}><span className="official-link-icon"><Icon size={17} /></span><span><strong>{link.label}</strong><small>{link.detail}</small></span><ExternalIcon external={link.external} /></a>; })}</div><div className="social-status-card"><div className="social-status-head"><span><Radio size={16} /> Social media</span><span className="coming-soon">Publishing soon</span></div><p>We could not verify official DeCave handles in the current project source, so this page does not point people to lookalike accounts.</p><div className="social-placeholder-grid">{socialChannels.map((channel) => { const Icon = channel.icon; return <span key={channel.label}><Icon size={14} />{channel.label}</span>; })}</div></div></div>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-main"><div className="footer-brand"><Brand /><p>Voice, Hubs, friends and screen sharing for the moments between queues.</p></div><div className="footer-column"><span>Explore</span><a href="/#features">Product</a><a href="/roadmap">Roadmap</a><a href="/help">Help center</a></div><div className="footer-column"><span>Trust</span><a href="/privacy">Privacy policy</a><a href="/terms">Terms of service</a><a href="/guidelines">Community guidelines</a><a href="mailto:security@example.invalid">Security contact</a></div><div className="footer-column"><span>Official</span><a href="/roadmap">DeCave release boundary <ArrowUpRight size={13} /></a><a href="/roadmap">Release status <ArrowUpRight size={13} /></a><a href="https://de-cave.com" target="_blank" rel="noreferrer">de-cave.com <ExternalLink size={13} /></a></div></div>
      <div className="footer-bottom"><span>© 2026 DeCave</span><span>Current release <strong>0.1.34</strong></span><span>Built for gaming, held to a higher bar.</span></div>
    </footer>
  );
}

function HomePage({ theme }: { theme: ThemeKey }) {
  return <div className={`site theme-${theme} redesigned-home`} id="top"><SiteNav /><main><Hero /><section className="landing-status-strip" aria-label="DeCave access status"><div><StatusBadge>Web app live</StatusBadge><strong>Use DeCave in your browser now</strong><span>The web app is available today. Protected messaging and the Windows release continue through their separate review paths.</span></div><a className="button-primary small" href="/roadmap">See the boundary <ArrowUpRight size={14} /></a></section><FeatureSection /><PreviewGallery /><RoadmapPreview /><SupportSection /><OfficialChannels /></main><SiteFooter /></div>;
}

function InfoHeader({ eyebrow, title, lead, updated }: { eyebrow: string; title: React.ReactNode; lead: string; updated: string }) {
  return <div className="info-header"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="info-lead">{lead}</p><div className="info-meta"><span><Clock3 size={14} /> {updated}</span><a href="/">Back to DeCave <ArrowUpRight size={14} /></a></div></div>;
}

function InfoLayout({ page, children, eyebrow, title, lead, updated }: { page: string; children: React.ReactNode; eyebrow: string; title: React.ReactNode; lead: string; updated: string }) {
  return <div className={`site theme-info ${page === "privacy" ? "theme-nebula" : "theme-signal"}`}><SiteNav page={page} /><main className="info-main"><InfoHeader eyebrow={eyebrow} title={title} lead={lead} updated={updated} />{children}</main><SiteFooter /></div>;
}


function GuidelinesPage() {
  const guidelines = [
    ["Make room for people", "Welcome new players, respect boundaries and give others a chance to speak. Competitive energy is good; making someone feel unsafe is not."],
    ["Keep it playable", "No harassment, hate, threats, targeted abuse, doxxing, stalking or deliberate disruption of voice rooms and Hubs."],
    ["Protect private information", "Do not post passwords, private keys, addresses, personal contact details, private conversations or someone else’s personal media."],
    ["Play fair", "No scams, impersonation, malicious links, cheating instructions, fraud, credential harvesting or attempts to bypass account and safety controls."],
    ["Share responsibly", "Mark spoilers, keep adult content out of general spaces and follow the rules of each Hub. Community owners may add clearer local rules."],
    ["Report, don’t retaliate", "Save the context, report the behavior through the official community path when available and do not organize pile-ons or public hunts."],
  ];
  return <InfoLayout page="guidelines" eyebrow="Community standards" title={<>Play hard.<br /><span>Keep it kind.</span></>} lead="DeCave is for the people between matches as much as the matches themselves. These guidelines set the floor for Hubs, rooms, DMs and the official community." updated="Published 30 Aug 2026"><div className="guidelines-hero"><div className="guidelines-hero-icon"><Users size={25} /></div><div><strong>Short version</strong><p>Be welcoming. Don’t harass. Don’t expose private information. Don’t scam or impersonate. If something feels unsafe, step away and report it.</p></div></div><div className="guideline-grid">{guidelines.map(([title, copy], index) => <article className="guideline-card" key={title}><span>0{index + 1}</span><h2>{title}</h2><p>{copy}</p></article>)}</div><div className="moderation-section"><div><p className="eyebrow">When something goes wrong</p><h2>Context helps.<br /><span>Retaliation doesn’t.</span></h2></div><div><p>Community owners and moderators can set local rules and remove content or access that breaks them. DeCave may restrict accounts or Hubs for serious or repeated abuse, fraud, security threats or legal requests.</p><p>When reporting, include the Hub or room, approximate time, usernames and a concise description. Do not forward sensitive conversations or private files unless an authorized safety process asks for them.</p><a className="button-secondary" href="/help">Open the help center <ArrowUpRight size={14} /></a></div></div><div className="guidelines-footer-note"><ShieldCheck size={17} /><span>These guidelines complement, but do not replace, applicable law, Hub-specific rules or the final legal terms that will accompany public launch.</span></div></InfoLayout>;
}

function HelpPage() {
  return <InfoLayout page="help" eyebrow="Help center" title={<>Answers for the<br /><span>next session.</span></>} lead="Start here for current access status, release notes, security language, screen-sharing guidance and safe support requests." updated="Updated 30 Aug 2026"><div className="help-quick-grid"><a href="/roadmap"><Rocket size={18} /><span><strong>Release status</strong><small>What is live, paused and next.</small></span><ArrowUpRight size={14} /></a><a href="/privacy"><LockKeyhole size={18} /><span><strong>Privacy & data</strong><small>Current routing disclosure.</small></span><ArrowUpRight size={14} /></a><a href="mailto:security@example.invalid"><ShieldAlert size={18} /><span><strong>Security report</strong><small>Email the security contact.</small></span><ArrowUpRight size={14} /></a></div><div className="help-search-shell"><Search size={17} /><span>Search is coming with the full docs portal.</span></div><div className="faq-list"><div className="faq-heading"><div><p className="eyebrow">Common questions</p><h2>Start with the<br /><span>clear answers.</span></h2></div><p>Until the full docs portal is published, this page is the current support brief.</p></div>{faqItems.map((item) => <details className="faq-item" key={item.question}><summary>{item.question}<ChevronDown size={17} /></summary><p>{item.answer}</p></details>)}</div><div className="help-contact-card"><div className="help-contact-icon"><MessageCircle size={20} /></div><div><p className="eyebrow">Need a human?</p><h2>Use the official community path.</h2><p>When access is available, the DeCave Community Hub is the right place for product questions and onboarding. For security or privacy concerns, email the dedicated security contact.</p><div className="help-contact-actions"><a className="button-primary" href="/roadmap">View release boundary <ArrowRight size={14} /></a><a className="button-secondary" href="mailto:security@example.invalid">Email security <Mail size={14} /></a></div></div></div></InfoLayout>;
}

function RoadmapPage() {
  return <InfoLayout page="roadmap" eyebrow="Product roadmap" title={<>The next unlock<br /><span>is earned.</span></>} lead="DeCave keeps a visible line between product polish, security evidence and future platform work. This is the current order of operations—not a promise of dates." updated="Reviewed 12 Sep 2026"><div className="roadmap-summary"><div><StatusBadge>Operator release · {CURRENT_OPERATOR_VERSION}</StatusBadge><h2>Product work is moving.<br /><span>Web access is live.</span></h2><p>The current Windows installer is available. The existing Android release path is unchanged. The Windows build is not yet Authenticode-signed.</p></div><div className="summary-metrics"><div><strong>{CURRENT_OPERATOR_VERSION}</strong><span>operator release</span></div><div><strong>1</strong><span>released client platform</span></div><div><strong>1</strong><span>artifact manifest</span></div></div></div><div className="detailed-roadmap">{roadmapItems.map((item) => { const Icon = item.icon; return <article className={`detailed-roadmap-row ${item.tone}`} key={item.number}><div className="detailed-roadmap-index"><span>{item.number}</span><Icon size={19} /></div><div className="detailed-roadmap-copy"><div className="roadmap-row-header"><span className="roadmap-state">{item.state}</span><span>{item.meta}</span></div><h2>{item.title}</h2><p>{item.copy}</p>{item.number === "02" && <div className="roadmap-checklist"><span><Check size={14} /> Operator authorization recorded</span><span><Check size={14} /> Native provider hashes pinned</span><span><Clock3 size={14} /> Independent review waived</span><span><Clock3 size={14} /> Authenticode signing waived</span></div>}</div></article>; })}</div><div className="roadmap-boundary"><ShieldAlert size={18} /><div><strong>The boundary stays explicit.</strong><p>The Windows installer is not yet Authenticode-signed, and the Android path is unchanged in this release. Neither artifact claims independent security review.</p></div></div></InfoLayout>;
}

const redesignScreenshots = [
  { src: "/screens/decave-live-home-sanitized.png", title: "Customizable home", copy: "Bring your hubs, friends, rooms, notes, and activity into one personal dashboard." },
  { src: "/screens/decave-live-dm-sanitized.png", title: "Direct messages", copy: "Keep private conversations close without losing sight of who is available." },
  { src: "/screens/decave-live-friends-sanitized.png", title: "Friends and presence", copy: "See who is online, offline, or already together in voice." },
  { src: "/screens/decave-live-squad-sanitized.png", title: "Squad Finder", copy: "Match by game, platform, language, region, and microphone preference." },
  { src: "/screens/decave-live-hub-sanitized.png", title: "Hubs and rooms", copy: "Organize forums, text rooms, and voice rooms around a shared community." },
  { src: "/screens/decave-live-voice-sanitized.png", title: "Voice and screen sharing", copy: "Stay in voice and share gameplay in a room designed around the whole session." },
];

function RedesignPreviewPage() {
  const [activeShot, setActiveShot] = useState<(typeof redesignScreenshots)[number] | null>(null);

  useEffect(() => {
    if (!activeShot) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveShot(null);
    };
    document.body.classList.add("concept-modal-open");
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.classList.remove("concept-modal-open");
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [activeShot]);

  return (
    <div className="concept-site">
      <header className="concept-nav">
        <a className="concept-brand" href="#top" aria-label="DeCave home"><Brand /></a>
        <nav aria-label="Preview navigation">
          <a href="#features">Features</a>
          <a href="#screenshots">Screenshots</a>
          <a href="#roadmap">Roadmap</a>
        </nav>
        <a className="concept-nav-cta" href={RELEASE_STATUS_URL}><Globe2 size={15} /> View release status <ArrowRight size={15} /></a>
      </header>

      <main id="top">
        <section className="concept-hero">
          <div className="concept-hero-copy">
            <div className="concept-alpha"><span /> Alpha release · not the final product</div>
            <h1>Your people.<br />Your games.<br /><span>One cave.</span></h1>
            <p>Low-latency voice, high-quality screen sharing, Hubs, friends, forums, and squad finding—kept together so the session never feels scattered.</p>
            <div className="concept-actions">
              <a className="concept-button primary" href={RELEASE_STATUS_URL}><Globe2 size={18} /> View release status <ExternalLink size={15} /></a>
              <a className="concept-button secondary" href="/help"><Download size={18} /> Read the help brief</a>
            </div>
            <div className="concept-utility-actions"><a href="/roadmap">View release boundary <ArrowUpRight size={14} /></a><a href="/help">Read the help brief <CircleHelp size={14} /></a></div>
            <p className="concept-release-note"><ShieldAlert size={15} /> Public testing is paused while the next release is prepared.</p>
          </div>
          <div className="concept-hero-visual">
            <div className="concept-visual-glow" aria-hidden="true" />
            <button className="concept-hero-image-button" type="button" onClick={() => setActiveShot({ src: "/screens/decave-home-hero-enhanced.png", title: "Customizable Home Dashboard", copy: "A larger view of the privacy-safe DeCave Home Dashboard." })} aria-label="Open larger view of the Home Dashboard">
              <img src="/screens/decave-home-hero-enhanced.png" alt="DeCave Home Dashboard with generic placeholder profiles" />
              <span><Monitor size={16} /> Click to enlarge</span>
            </button>
          </div>
        </section>

        <section className="concept-section concept-features" id="features">
          <div className="concept-section-heading"><div><span>Built for the whole session</span><h2>Everything your group needs,<br />without the tab switching.</h2></div><p>DeCave keeps the social layer around the game visible, responsive, and easy to reach.</p></div>
          <div className="concept-feature-grid">
            {featureCards.map((feature) => { const Icon = feature.icon; return <article className="concept-feature-card" key={feature.title}><div className={`concept-feature-icon ${feature.tone}`}><Icon size={21} /></div><span>{feature.label}</span><h3>{feature.title}</h3><p>{feature.copy}</p></article>; })}
          </div>
        </section>

        <section className="concept-section concept-screens" id="screenshots">
          <div className="concept-section-heading"><div><span>Live product views</span><h2>See the alpha<br />as it looks today.</h2></div><p>Only screenshots supplied for this site are shown. Names, messages, account details, and profile identities use privacy-safe replacements.</p></div>
          <div className="concept-shot-grid">
            {redesignScreenshots.map((shot) => <article className="concept-shot-card" key={shot.src}><button type="button" onClick={() => setActiveShot(shot)} aria-label={`Open larger view of ${shot.title}`}><img src={shot.src} alt={`${shot.title} with generic placeholder profiles`} /><span className="concept-shot-expand"><Monitor size={15} /> View larger</span></button><div><h3>{shot.title}</h3><p>{shot.copy}</p></div></article>)}
          </div>
        </section>

        <section className="concept-section concept-roadmap" id="roadmap">
          <div className="concept-section-heading"><div><span>Roadmap</span><h2>Build the fun.<br />Earn the trust.</h2></div><p>The product keeps moving, while security claims stay behind a clear evidence and review gate.</p></div>
          <div className="concept-roadmap-list">
            {roadmapItems.map((item) => { const Icon = item.icon; return <article className={`concept-roadmap-item ${item.tone}`} key={item.number}><div className="concept-roadmap-index">{item.number}</div><div className="concept-roadmap-icon"><Icon size={19} /></div><div><span>{item.state}</span><h3>{item.title}</h3><p>{item.copy}</p><small>{item.meta}</small></div></article>; })}
          </div>
        </section>

        <section className="concept-final-cta">
          <div><span>DeCave alpha</span><h2>Bring the next session together.</h2><p>Public access is paused while the next release is prepared.</p></div>
          <div className="concept-actions"><a className="concept-button primary" href="/roadmap"><ShieldAlert size={18} /> View release boundary</a><a className="concept-button secondary" href="/help"><CircleHelp size={18} /> Read the help brief</a></div>
        </section>
      </main>

      <footer className="concept-footer"><Brand /><span>Alpha release · not the final product</span><span>© 2026 DeCave</span></footer>

      {activeShot && <div className="concept-lightbox" role="dialog" aria-modal="true" aria-label={`${activeShot.title} enlarged screenshot`} onMouseDown={(event) => { if (event.currentTarget === event.target) setActiveShot(null); }}><div className="concept-lightbox-panel"><div><span>Product screenshot</span><strong>{activeShot.title}</strong><button type="button" onClick={() => setActiveShot(null)} aria-label="Close enlarged screenshot"><X size={20} /></button></div><img src={activeShot.src} alt={`${activeShot.title} enlarged with generic placeholder profiles`} /></div></div>}
    </div>
  );
}

function App() {
  const normalizedPath = window.location.pathname.replace(/\/+$/, "") || "/";

  if (normalizedPath === "/privacy" || normalizedPath === "/privacy-policy") return <PrivacyPage />;
  if (normalizedPath === "/terms" || normalizedPath === "/terms-of-service") return <TermsPage />;
  if (normalizedPath === "/guidelines" || normalizedPath === "/community-guidelines" || normalizedPath === "/community") return <GuidelinesPage />;
  if (normalizedPath === "/help" || normalizedPath === "/help-center") return <HelpPage />;
  if (normalizedPath === "/roadmap") return <RoadmapPage />;
  if (normalizedPath === "/preview") return <PublicPreviewPage />;
  if (normalizedPath === "/redesign-preview") return <RedesignPreviewPage />;
  return <RedesignPreviewPage />;
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
