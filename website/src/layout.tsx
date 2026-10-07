// Shared site chrome: links, brand, navigation, footer and the layout used by
// the text pages (privacy, terms, guidelines, help, roadmap).

import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight, Clock3, Menu, X } from "lucide-react";

declare const __DECAVE_VERSION__: string;

export const APP_VERSION = __DECAVE_VERSION__;
export const WEB_APP_URL = "https://app.de-cave.com";
// The release script refreshes these stable URLs on every release.
export const WINDOWS_DOWNLOAD_URL = "https://downloads.de-cave.com/DeCave-Setup.exe";
export const MAC_APPLE_SILICON_URL = "https://downloads.de-cave.com/DeCave-Mac-arm64.dmg";
export const MAC_INTEL_URL = "https://downloads.de-cave.com/DeCave-Mac-x64.dmg";
export const SUPPORT_EMAIL = "support@de-cave.com";
export const SECURITY_EMAIL = "security@de-cave.com";

export function Brand() {
  return (
    <a className="brand" href="/" aria-label="DeCave home">
      <img src="/brand/decave-mark.png" alt="" width="34" height="34" />
      <span>
        De<strong>C</strong>ave
      </span>
    </a>
  );
}

const navLinks = [
  { label: "Tour", href: "/#tour" },
  { label: "Download", href: "/#download" },
  { label: "Roadmap", href: "/#roadmap" },
  { label: "Q&A", href: "/#qa" },
  { label: "Resources", href: "/#resources" },
];

export function SiteNav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={`nav${scrolled ? " is-scrolled" : ""}`}>
      <div className="alpha-strip">
        <strong>Alpha</strong>
        <span className="alpha-long">
          DeCave is an early alpha, not a full release. Expect rough edges and frequent updates. 18+ only.
        </span>
        <span className="alpha-short">Early alpha, not a full release · 18+</span>
        <a href="/roadmap">See the roadmap</a>
      </div>
      <div className="nav-inner">
        <Brand />
        <nav className="nav-links" aria-label="Primary">
          {navLinks.map((link) => (
            <a key={link.label} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
        <div className="nav-actions">
          <a className="btn btn-primary btn-sm" href={WEB_APP_URL}>
            Open DeCave <ArrowRight size={15} aria-hidden="true" />
          </a>
          <button
            className="nav-toggle"
            type="button"
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>
      {open && (
        <nav className="nav-mobile" id="mobile-nav" aria-label="Mobile">
          {navLinks.map((link) => (
            <a key={link.label} href={link.href} onClick={() => setOpen(false)}>
              {link.label}
            </a>
          ))}
          <a href="/privacy" onClick={() => setOpen(false)}>
            Privacy
          </a>
        </nav>
      )}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <Brand />
          <p>Voice, Hubs, friends and screen sharing for the people you play with.</p>
        </div>
        <div className="footer-col">
          <span>Product</span>
          <a href="/#features">Features</a>
          <a href="/#tour">Tour</a>
          <a href="/#download">Download</a>
          <a href="/roadmap">Roadmap</a>
          <a href="/#qa">Q&amp;A</a>
          <a href="/#resources">Resources</a>
        </div>
        <div className="footer-col">
          <span>Support</span>
          <a href="/help">Help center</a>
          <a href="/guidelines">Community guidelines</a>
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
          <a href={`mailto:${SECURITY_EMAIL}`}>Report a security issue</a>
        </div>
        <div className="footer-col">
          <span>Legal</span>
          <a href="/privacy">Privacy policy</a>
          <a href="/terms">Terms of service</a>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} DeCave</span>
        <span>
          Current release <strong>{APP_VERSION}</strong>
        </span>
      </div>
    </footer>
  );
}

export function PageLayout({
  eyebrow,
  title,
  lead,
  updated,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  lead: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <div className="site">
      <SiteNav />
      <main className="page">
        <header className="page-header">
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="page-lead">{lead}</p>
          <p className="page-meta">
            <Clock3 size={14} aria-hidden="true" /> {updated}
          </p>
        </header>
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
