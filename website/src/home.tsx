// The public landing page uses text-led product highlights rather than private
// or unreviewed screenshots.

import { useRef, useState } from "react";
import {
  Apple,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Download,
  Gamepad2,
  Globe2,
  Keyboard,
  LockKeyhole,
  MonitorUp,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { FaqList, roadmap } from "./pages";
import {
  APP_VERSION,
  MAC_APPLE_SILICON_URL,
  SECURITY_EMAIL,
  SUPPORT_EMAIL,
  MAC_INTEL_URL,
  SiteFooter,
  SiteNav,
  WEB_APP_URL,
  WINDOWS_DOWNLOAD_URL,
} from "./layout";

type Screen = { id: string; label: string; title: string; copy: string };

const screens: Screen[] = [
  {
    id: "hub",
    label: "Hubs",
    title: "Rooms for every topic",
    copy: "Text, voice and forum rooms grouped the way your community thinks. See who’s already in voice before you join.",
  },
  {
    id: "voice",
    label: "Voice",
    title: "Voice that stays out of the way",
    copy: "Clear participant cards, quick mute and deafen, camera and screen sharing from one control bar.",
  },
  {
    id: "dms",
    label: "Messages",
    title: "Private conversations",
    copy: "Direct messages with search, unread filters and one-click voice or video calls.",
  },
  {
    id: "friends",
    label: "Friends",
    title: "Know who’s around",
    copy: "Presence and activity at a glance, friend requests in one place and a DeCave ID that’s easy to share.",
  },
  {
    id: "squad",
    label: "Squad Finder",
    title: "Fill the team",
    copy: "Match by game, platform, language, region and microphone preference, then join the group in one click.",
  },
  {
    id: "discover",
    label: "Discover",
    title: "Find a Hub worth joining",
    copy: "Browse public Hubs by category, size and activity, preview them first or join with an invite code.",
  },
  {
    id: "official",
    label: "DeCave Hub",
    title: "News and help in one place",
    copy: "Every account joins the official DeCave Hub: announcements, patch notes, the roadmap, rules and an FAQ from the team.",
  },
  {
    id: "home",
    label: "Home",
    title: "Your dashboard, your way",
    copy: "Jump back into your last room, see who’s online and what they’re playing, join a voice room and keep upcoming events in view.",
  },
];

const byId = (id: string) => screens.find((screen) => screen.id === id)!;

function Shot({ screen }: { screen: Screen }) {
  return (
    <div className="shot" role="group" aria-label={`${screen.label}: ${screen.title}`}>
      <span className="shot-label">{screen.label}</span>
      <h3>{screen.title}</h3>
      <p>{screen.copy}</p>
      <span className="shot-mark" aria-hidden="true" />
    </div>
  );
}

function Hero() {
  return (
    <section className="hero">
      <div className="hero-copy">
        <a className="pill" href="/roadmap">
          <span className="pill-dot" aria-hidden="true" /> Alpha · Release {APP_VERSION} · Web, Mac & Windows
        </a>
        <h1>
          Where your squad <span className="grad">hangs out</span> between matches.
        </h1>
        <p className="lead">
          DeCave brings voice, Hubs, friends, DMs and screen sharing into one place, built for the small groups you
          actually play with.
        </p>
        <div className="hero-actions">
          <a className="btn btn-primary btn-lg" href={WEB_APP_URL}>
            Open in your browser <ArrowRight size={17} aria-hidden="true" />
          </a>
          <a className="btn btn-ghost btn-lg" href={WINDOWS_DOWNLOAD_URL}>
            <Download size={17} aria-hidden="true" /> Download for Windows
          </a>
        </div>
        <p className="hero-sub">
          Also on Mac for <a href={MAC_APPLE_SILICON_URL}>Apple silicon</a> and <a href={MAC_INTEL_URL}>Intel</a>. Free,
          for adults 18+. The Windows build is not code-signed yet.
        </p>
      </div>
      <div className="hero-visual">
        <div className="hero-glow" aria-hidden="true" />
        <div className="window">
          <div className="window-bar" aria-hidden="true">
            <i />
            <i />
            <i />
            <span>app.de-cave.com</span>
          </div>
          <Shot screen={byId("home")} />
        </div>
      </div>
    </section>
  );
}

function Tour() {
  const [active, setActive] = useState(screens[0].id);
  const current = byId(active);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const move = (delta: number) => {
    const index = screens.findIndex((screen) => screen.id === active);
    const next = screens[(index + delta + screens.length) % screens.length];
    setActive(next.id);
    tabRefs.current[next.id]?.focus();
  };

  return (
    <section className="section" id="tour" aria-labelledby="tour-heading">
      <div className="section-head">
        <p className="eyebrow">Take the tour</p>
        <h2 id="tour-heading">
          One place for your whole squad.
        </h2>
        <p>Explore the core spaces and tools built into DeCave.</p>
      </div>
      <div
        className="tabs"
        role="tablist"
        aria-label="App screens"
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") move(1);
          if (event.key === "ArrowLeft") move(-1);
        }}
      >
        {screens.map((screen) => (
          <button
            key={screen.id}
            ref={(node) => {
              tabRefs.current[screen.id] = node;
            }}
            type="button"
            role="tab"
            id={`tab-${screen.id}`}
            aria-selected={screen.id === active}
            aria-controls="tour-panel"
            tabIndex={screen.id === active ? 0 : -1}
            onClick={() => setActive(screen.id)}
          >
            {screen.label}
          </button>
        ))}
      </div>
      <div className="tour-panel" role="tabpanel" id="tour-panel" aria-labelledby={`tab-${current.id}`}>
        <div className="tour-caption">
          <h3>{current.title}</h3>
          <p>{current.copy}</p>
        </div>
        <div className="window">
          <Shot key={current.id} screen={current} />
        </div>
      </div>
    </section>
  );
}

const spotlights = [
  {
    screen: "hub",
    eyebrow: "Hubs",
    title: "Build a Hub around your people.",
    copy: "Create text, voice and forum rooms, sort them into sections and give your community a home page with its own events, members and announcements.",
    points: ["Text, voice and forum rooms", "Roles, invites and moderation tools", "See who’s in voice before you join"],
  },
  {
    screen: "voice",
    eyebrow: "Voice & screen sharing",
    title: "Hop in. Share the play.",
    copy: "Low-latency voice with quick controls, plus screen sharing up to 1440p at 60 FPS when your connection has the headroom.",
    points: ["Mute, deafen and push-to-talk", "Camera and screen sharing", "Desktop overlay while you play"],
  },
  {
    screen: "official-info",
    eyebrow: "The DeCave Hub",
    title: "Follow the alpha as it grows.",
    copy: "Every account joins the official DeCave Hub. It’s where the team posts announcements, patch notes and the roadmap, with the rules, an FAQ and helpful links one click away.",
    points: ["Announcements and patch notes", "Roadmap and alpha status", "Rules, FAQ and resources"],
  },
  {
    screen: "hub-home",
    eyebrow: "Events",
    title: "Get everyone there on time.",
    copy: "Schedule raid nights and tournaments, collect RSVPs and send reminders. Upcoming events show up on every member’s Home.",
    points: ["Recurring events and reminders", "RSVPs with who’s going", "Hub calendar and Home widget"],
  },
];

function Spotlights() {
  const hubHome: Screen = {
    id: "hub-home",
    label: "Hub Home",
    title: "Hub Home and events",
    copy: "Upcoming events, RSVPs and members on a Hub’s home page.",
  };
  const officialInfo: Screen = {
    id: "official-info",
    label: "DeCave Hub",
    title: "The official DeCave Hub",
    copy: "Announcements, the roadmap, helpful resources and privacy notes from the DeCave team.",
  };
  return (
    <section className="section" id="features" aria-label="Features">
      {spotlights.map((item, index) => {
        const screen =
          item.screen === "hub-home" ? hubHome : item.screen === "official-info" ? officialInfo : byId(item.screen);
        return (
          <article className={`spotlight${index % 2 ? " is-flipped" : ""}`} key={item.title}>
            <div className="spotlight-copy">
              <p className="eyebrow">{item.eyebrow}</p>
              <h2>{item.title}</h2>
              <p>{item.copy}</p>
              <ul>
                {item.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </div>
            <div className="window">
              <Shot screen={screen} />
            </div>
          </article>
        );
      })}
    </section>
  );
}

const features = [
  { icon: MonitorUp, title: "Screen sharing up to 1440p60", copy: "Quality profiles from a steady 1080p30 to high-motion 1440p60." },
  { icon: Gamepad2, title: "Squad Finder", copy: "Find players by game, platform, language, region and mic." },
  { icon: CalendarDays, title: "Events & calendar", copy: "Recurring Hub events with RSVPs and reminders." },
  { icon: Keyboard, title: "Desktop overlay & hotkeys", copy: "Global mute and deafen keys and an in-game voice overlay." },
  { icon: ShieldCheck, title: "Safety built in", copy: "Reports, blocking, moderation cases, age checks and owner MFA." },
  { icon: RefreshCw, title: "Automatic updates", copy: "Desktop apps update in the background and install on restart." },
];

function FeatureGrid() {
  return (
    <section className="section" aria-labelledby="more-heading">
      <div className="section-head">
        <p className="eyebrow">And more</p>
        <h2 id="more-heading">
          The details that <span className="grad">keep sessions smooth.</span>
        </h2>
      </div>
      <div className="feature-grid">
        {features.map(({ icon: Icon, title, copy }) => (
          <article className="feature" key={title}>
            <span className="feature-icon">
              <Icon size={20} aria-hidden="true" />
            </span>
            <h3>{title}</h3>
            <p>{copy}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function Downloads() {
  return (
    <section className="section" id="download" aria-labelledby="download-heading">
      <div className="section-head">
        <p className="eyebrow">Get the alpha</p>
        <h2 id="download-heading">
          Start in the browser. <span className="grad">Stay on desktop.</span>
        </h2>
        <p>
          One account everywhere. Current alpha release {APP_VERSION}. DeCave is free and for adults 18+.
        </p>
      </div>
      <div className="download-grid">
        <article className="download is-featured">
          <Globe2 size={26} aria-hidden="true" />
          <h3>Web app</h3>
          <p>Nothing to install. Works in Chrome, Edge, Firefox and Safari.</p>
          <a className="btn btn-primary" href={WEB_APP_URL}>
            Open app.de-cave.com <ArrowRight size={15} aria-hidden="true" />
          </a>
        </article>
        <article className="download">
          <Apple size={26} aria-hidden="true" />
          <h3>Mac</h3>
          <p>Signed and notarized by Apple. Updates install automatically.</p>
          <div className="download-split">
            <a className="btn btn-ghost" href={MAC_APPLE_SILICON_URL}>
              <Download size={15} aria-hidden="true" /> Apple silicon
            </a>
            <a className="btn btn-ghost" href={MAC_INTEL_URL}>
              <Download size={15} aria-hidden="true" /> Intel
            </a>
          </div>
        </article>
        <article className="download">
          <div className="download-title">
            <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
              <path
                fill="currentColor"
                d="M3 5.5 10.5 4.5v7H3zm8.5-1.1L21 3v8.5h-9.5zM3 12.5h7.5v7L3 18.5zm8.5 0H21V21l-9.5-1.4z"
              />
            </svg>
            <span className="badge-warn">Not signed yet</span>
          </div>
          <h3>Windows</h3>
          <p>Windows 10 and 11, 64-bit. Updates install automatically.</p>
          <a className="btn btn-ghost" href={WINDOWS_DOWNLOAD_URL}>
            <Download size={15} aria-hidden="true" /> Download .exe
          </a>
          <small>
            The Windows installer is not code-signed yet, so SmartScreen may warn you. Choose More info → Run anyway if
            you downloaded it from downloads.de-cave.com.
          </small>
        </article>
      </div>
    </section>
  );
}

function RoadmapSection() {
  return (
    <section className="section" id="roadmap" aria-labelledby="roadmap-heading">
      <div className="section-head">
        <p className="eyebrow">Roadmap</p>
        <h2 id="roadmap-heading">
          Alpha today. <span className="grad">Here’s what’s next.</span>
        </h2>
        <p>The current order of work. A direction, not a promise of dates.</p>
      </div>
      <ol className="home-roadmap">
        {roadmap.map((item) => (
          <li className={`tone-${item.tone}`} key={item.title}>
            <span className="home-roadmap-state">{item.state}</span>
            <h3>{item.title}</h3>
            <p>{item.copy}</p>
          </li>
        ))}
      </ol>
      <p className="section-more">
        <a href="/roadmap">
          Open the full roadmap <ArrowUpRight size={15} aria-hidden="true" />
        </a>
      </p>
    </section>
  );
}

const resources = [
  { title: "Open the web app", detail: "app.de-cave.com", href: WEB_APP_URL },
  { title: "Help center", detail: "Getting started, updates and fixes", href: "/help" },
  { title: "Roadmap", detail: "What’s live and what’s next", href: "/roadmap" },
  { title: "Community guidelines", detail: "How we keep Hubs kind", href: "/guidelines" },
  { title: "Privacy policy", detail: "What we collect and why", href: "/privacy" },
  { title: "Terms of service", detail: "The rules for using DeCave", href: "/terms" },
  { title: "Email support", detail: SUPPORT_EMAIL, href: `mailto:${SUPPORT_EMAIL}` },
  { title: "Report a security issue", detail: SECURITY_EMAIL, href: `mailto:${SECURITY_EMAIL}` },
];

function Resources() {
  return (
    <section className="section" id="resources" aria-labelledby="resources-heading">
      <div className="section-head">
        <p className="eyebrow">Helpful resources</p>
        <h2 id="resources-heading">Everything in one place.</h2>
      </div>
      <div className="resource-grid">
        {resources.map((item) => (
          <a className="resource" href={item.href} key={item.title}>
            <span>
              <strong>{item.title}</strong>
              <small>{item.detail}</small>
            </span>
            <ArrowUpRight size={16} aria-hidden="true" />
          </a>
        ))}
      </div>
    </section>
  );
}

function Trust() {
  return (
    <section className="trust" aria-labelledby="trust-heading">
      <LockKeyhole size={22} aria-hidden="true" />
      <div>
        <h2 id="trust-heading">Straight answers about your data</h2>
        <p>
          Direct messages, group chats, calls and voice rooms are end-to-end encrypted, and TLS protects traffic to
          DeCave. Hub rooms and forums are stored readable so they can be delivered,
          synced and moderated. No advertising SDKs.
        </p>
      </div>
      <a className="btn btn-ghost" href="/privacy">
        Read the privacy policy
      </a>
    </section>
  );
}

export function HomePage() {
  return (
    <div className="site">
      <SiteNav />
      <main>
        <Hero />
        <Tour />
        <Spotlights />
        <FeatureGrid />
        <Downloads />
        <RoadmapSection />
        <section className="section" id="qa" aria-labelledby="faq-heading">
          <div className="section-head">
            <p className="eyebrow">Q&amp;A</p>
            <h2 id="faq-heading">Questions and answers.</h2>
          </div>
          <FaqList />
        </section>
        <Resources />
        <Trust />
        <section className="cta">
          <h2>Bring the next session together.</h2>
          <a className="btn btn-primary btn-lg" href={WEB_APP_URL}>
            Open DeCave <ArrowRight size={17} aria-hidden="true" />
          </a>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
