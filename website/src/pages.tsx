// Text pages: community guidelines, help center and roadmap.

import { ArrowRight, ChevronDown, LockKeyhole, Mail, MessageCircle, Rocket, ShieldAlert } from "lucide-react";
import { APP_VERSION, PageLayout, SECURITY_EMAIL, SUPPORT_EMAIL, WEB_APP_URL } from "./layout";

export const faqItems = [
  {
    question: "Is DeCave finished?",
    answer:
      "No. DeCave is an alpha: it works and it’s free, but it isn’t a full release yet. Expect rough edges, frequent updates and features that change as we learn. Your feedback decides what we fix and build next.",
  },
  {
    question: "Who can use DeCave?",
    answer:
      "DeCave is for adults aged 18 and over. When you create an account you confirm your birth date and accept the Terms of Service and Privacy Policy. We keep only an age band, never your exact birth date.",
  },
  {
    question: "Where can I use DeCave?",
    answer:
      "In any modern browser at app.de-cave.com, and in the desktop apps for Mac (Apple silicon and Intel) and Windows. Your account, Hubs and conversations are the same everywhere. Mobile apps are on the roadmap.",
  },
  {
    question: "How do desktop updates work?",
    answer:
      "The Windows and Mac apps check for updates shortly after launch and every few hours. New versions download in the background and install when you restart or quit the app. You can also check manually in Settings.",
  },
  {
    question: "Why does Windows show a SmartScreen prompt?",
    answer:
      "The Windows installer is not yet Authenticode-signed, so Windows may warn on first install. Choose More info → Run anyway if you downloaded it from downloads.de-cave.com. Signing is on the roadmap. The Mac app is signed and notarized by Apple.",
  },
  {
    question: "How are messages protected?",
    answer:
      "Direct messages and group chats are end-to-end encrypted, so DeCave can’t read them. Calls and voice rooms are end-to-end encrypted too: media goes directly between devices, and apps check each participant against their account key. TLS protects traffic between your device and DeCave. Hub rooms and forums are stored readable so DeCave can deliver, sync and moderate them.",
  },
  {
    question: "What screen-sharing quality should I use?",
    answer:
      "Start with Auto, which uses a steady 1080p30 baseline. Pick 1080p60 or 1440p60 when you have the upload bandwidth and GPU headroom. Voice rooms run peer-to-peer, which works best for small groups.",
  },
  {
    question: "How do I give feedback or report a bug?",
    answer:
      "Use Feedback in the app’s left rail, or email support@de-cave.com. The official DeCave Hub, which every account joins, has announcements, patch notes, the roadmap and an FAQ.",
  },
  {
    question: "What should I include in a support request?",
    answer:
      "Your app version (Settings → About), platform, browser or OS, the kind of room, the exact steps and what you expected to happen. Leave out passwords, tokens, private conversations and personal files.",
  },
  {
    question: "Where do I report a security issue?",
    answer:
      "Email security@de-cave.com with a short description and safe reproduction steps. Do not include passwords, private keys, sensitive conversations or unredacted files.",
  },
];

export function FaqList({ items = faqItems }: { items?: typeof faqItems }) {
  return (
    <div className="faq">
      {items.map((item) => (
        <details key={item.question}>
          <summary>
            {item.question}
            <ChevronDown size={18} aria-hidden="true" />
          </summary>
          <p>{item.answer}</p>
        </details>
      ))}
    </div>
  );
}

export function HelpPage() {
  return (
    <PageLayout
      eyebrow="Help center"
      title={
        <>
          Answers for the <span>next session.</span>
        </>
      }
      lead="Getting started, updates, screen sharing, privacy and how to reach a human."
      updated={`Updated for release ${APP_VERSION}`}
    >
      <div className="help-links">
        <a href={WEB_APP_URL}>
          <Rocket size={18} aria-hidden="true" />
          <span>
            <strong>Open the web app</strong>
            <small>Sign in or create an account.</small>
          </span>
        </a>
        <a href="/privacy">
          <LockKeyhole size={18} aria-hidden="true" />
          <span>
            <strong>Privacy & data</strong>
            <small>What we collect and why.</small>
          </span>
        </a>
        <a href={`mailto:${SECURITY_EMAIL}`}>
          <ShieldAlert size={18} aria-hidden="true" />
          <span>
            <strong>Security report</strong>
            <small>{SECURITY_EMAIL}</small>
          </span>
        </a>
      </div>
      <section className="page-section">
        <h2>Common questions</h2>
        <FaqList />
      </section>
      <section className="contact-card">
        <MessageCircle size={22} aria-hidden="true" />
        <div>
          <h2>Still stuck?</h2>
          <p>Email us with the details above and we will get back to you.</p>
        </div>
        <a className="btn btn-primary" href={`mailto:${SUPPORT_EMAIL}`}>
          Email support <Mail size={15} aria-hidden="true" />
        </a>
      </section>
    </PageLayout>
  );
}

const guidelines: Array<[string, string]> = [
  [
    "Make room for people",
    "Welcome new players, respect boundaries and give others a chance to speak. Competitive energy is good; making someone feel unsafe is not.",
  ],
  [
    "Keep it playable",
    "No harassment, hate, threats, targeted abuse, doxxing, stalking or deliberate disruption of voice rooms and Hubs.",
  ],
  [
    "Protect private information",
    "Do not post passwords, private keys, addresses, personal contact details, private conversations or someone else’s personal media.",
  ],
  [
    "Play fair",
    "No scams, impersonation, malicious links, cheating instructions, fraud, credential harvesting or attempts to bypass account and safety controls.",
  ],
  [
    "Share responsibly",
    "Mark spoilers, keep adult content out of general spaces and follow the rules of each Hub. Community owners may add clearer local rules.",
  ],
  [
    "Report, don’t retaliate",
    "Save the context, report the behavior with the in-app report tools and do not organize pile-ons or public hunts.",
  ],
];

export function GuidelinesPage() {
  return (
    <PageLayout
      eyebrow="Community guidelines"
      title={
        <>
          Play hard. <span>Keep it kind.</span>
        </>
      }
      lead="DeCave is for the people between matches as much as the matches themselves. These guidelines set the floor for every Hub, room and DM."
      updated="Published 30 Aug 2026"
    >
      <div className="callout">
        <strong>Short version:</strong> be welcoming. Don’t harass. Don’t expose private information. Don’t scam or
        impersonate. If something feels unsafe, step away and report it.
      </div>
      <div className="card-grid">
        {guidelines.map(([title, copy], index) => (
          <article className="card" key={title}>
            <span className="card-index">0{index + 1}</span>
            <h2>{title}</h2>
            <p>{copy}</p>
          </article>
        ))}
      </div>
      <section className="page-section prose">
        <h2>When something goes wrong</h2>
        <p>
          Hub owners and moderators can set local rules and remove content or access that breaks them. DeCave may
          restrict accounts or Hubs for serious or repeated abuse, fraud, security threats or legal requests.
        </p>
        <p>
          When reporting, include the Hub or room, the approximate time, usernames and a short description. Do not
          forward sensitive conversations or private files unless a safety process asks for them.
        </p>
        <p className="muted">
          These guidelines complement, but do not replace, applicable law, Hub-specific rules and the{" "}
          <a href="/terms">Terms of service</a>.
        </p>
      </section>
    </PageLayout>
  );
}

export const roadmap = [
  {
    state: "Shipped",
    tone: "done",
    title: "A home for the whole session",
    copy: "Customizable Home dashboard, Hubs with text, voice and forum rooms, Hub events and calendar, Squad Finder, Discover, friends and DMs on web, Windows and Mac.",
    meta: `Current line · ${APP_VERSION}`,
  },
  {
    state: "In progress",
    tone: "active",
    title: "Desktop polish and trust",
    copy: "Windows Authenticode signing, steadier voice and screen sharing, and the reliability and safety fixes from ongoing reviews.",
    meta: "Windows and Mac",
  },
  {
    state: "Next",
    tone: "next",
    title: "Mobile up to date",
    copy: "Fresh Android and iOS builds with the current sign-in, message history and calls on the same path as desktop.",
    meta: "Android and iOS",
  },
  {
    state: "Later",
    tone: "later",
    title: "Bigger rooms",
    copy: "A media-server path for larger voice and screen-share rooms beyond today’s peer-to-peer mesh.",
    meta: "Needs a new media path",
  },
];

export function RoadmapPage() {
  return (
    <PageLayout
      eyebrow="Roadmap"
      title={
        <>
          What’s live, <span>and what’s next.</span>
        </>
      }
      lead="DeCave is in alpha, not a full release. This is the current order of work: a direction, not a promise of dates."
      updated={`Current release ${APP_VERSION}`}
    >
      <ol className="roadmap">
        {roadmap.map((item) => (
          <li className={`roadmap-item tone-${item.tone}`} key={item.title}>
            <span className="roadmap-state">{item.state}</span>
            <div>
              <h2>{item.title}</h2>
              <p>{item.copy}</p>
              <small>{item.meta}</small>
            </div>
          </li>
        ))}
      </ol>
      <section className="contact-card">
        <Rocket size={22} aria-hidden="true" />
        <div>
          <h2>Try the current release</h2>
          <p>Everything marked shipped is available in the web app today.</p>
        </div>
        <a className="btn btn-primary" href={WEB_APP_URL}>
          Open DeCave <ArrowRight size={15} aria-hidden="true" />
        </a>
      </section>
    </PageLayout>
  );
}
