import { useState } from "react";

type Props = {
  appName: string;
  version: string;
  platform: string;
  username: string;
  /** False in desktop builds whose shell blocks mailto: links; we copy instead. */
  canOpenMail: boolean;
  /** Opens #patch-notes in DeCave Official; null when you aren't in that Hub. */
  onOpenPatchNotes: (() => void) | null;
  /** Desktop opens links through the shell allowlist; null renders normal new-tab links (web). */
  openExternal: ((url: string) => void) | null;
};

const LEGAL_LINKS = [
  { label: "Privacy Policy", url: "https://de-cave.com/privacy" },
  { label: "Terms of Service", url: "https://de-cave.com/terms" },
] as const;

/** Settings → Support: get help, report a bug with the details filled in, see what's new. */
export function SupportPanel({
  appName,
  version,
  platform,
  username,
  canOpenMail,
  onOpenPatchNotes,
  openExternal,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [copiedTemplate, setCopiedTemplate] = useState("");
  const details = [
    `App: ${appName} ${version}`,
    `Platform: ${platform}`,
    `Browser: ${typeof navigator !== "undefined" ? navigator.userAgent : "unknown"}`,
    `Account: ${username}`,
    `Time: ${new Date().toISOString()}`,
  ].join("\n");
  const mail = (subject: string, intro: string) =>
    `mailto:support@de-cave.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`${intro}\n\n\n---\n${details}\n`)}`;
  const BUG = "What happened?\n\nWhat did you expect to happen?\n\nSteps to make it happen again:\n1.\n2.\n3.";
  const copyTemplate = async (id: string, intro: string) => {
    try {
      await navigator.clipboard.writeText(`To: support@de-cave.com\n\n${intro}\n\n\n---\n${details}\n`);
      setCopiedTemplate(id);
      setTimeout(() => setCopiedTemplate(""), 2400);
    } catch {
      /* clipboard blocked */
    }
  };
  const tile = (id: string, subject: string, intro: string, title: string, detail: string) =>
    canOpenMail ? (
      <a className="dcs-support-tile" href={mail(subject, intro)}>
        <strong>{title}</strong>
        <small>{detail}</small>
      </a>
    ) : (
      <button type="button" className="dcs-support-tile" onClick={() => void copyTemplate(id, intro)}>
        <strong>{title}</strong>
        <small>
          {copiedTemplate === id
            ? "Copied. Paste it into an email to support@de-cave.com."
            : `${detail} Copies a ready-to-send email to paste.`}
        </small>
      </button>
    );
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(details);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <>
      <div className="dcs-support-grid">
        {tile("bug", "DeCave bug report", BUG, "Report a bug", "Your app version and device are filled in for you.")}
        {tile(
          "help",
          "DeCave support request",
          "How can we help?",
          "Contact support",
          "Questions about your account or your Hubs. We reply by email.",
        )}
        <button
          type="button"
          className="dcs-support-tile"
          disabled={!onOpenPatchNotes}
          onClick={() => onOpenPatchNotes?.()}
        >
          <strong>What's new</strong>
          <small>
            {onOpenPatchNotes
              ? "Read the latest patch notes in DeCave Official."
              : "Join DeCave Official to read patch notes."}
          </small>
        </button>
      </div>
      <div className="dcs-card">
        <dl className="dcs-about">
          <div>
            <dt>App</dt>
            <dd>{appName}</dd>
          </div>
          <div>
            <dt>Version</dt>
            <dd data-installed-version={version}>{version}</dd>
          </div>
          <div>
            <dt>Platform</dt>
            <dd>{platform}</dd>
          </div>
          <div>
            <dt>Service</dt>
            <dd>app.de-cave.com</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>support@de-cave.com</dd>
          </div>
          <div>
            <dt>Legal</dt>
            <dd className="dcs-legal-links">
              {LEGAL_LINKS.map(({ label, url }, index) => (
                <span key={url}>
                  {index > 0 ? " · " : null}
                  {openExternal ? (
                    <a
                      href={url}
                      onClick={(event) => {
                        event.preventDefault();
                        openExternal(url);
                      }}
                    >
                      {label}
                    </a>
                  ) : (
                    <a href={url} target="_blank" rel="noopener noreferrer">
                      {label}
                    </a>
                  )}
                </span>
              ))}
            </dd>
          </div>
        </dl>
        <div className="dcs-card-actions">
          <button type="button" className="modal-secondary" onClick={() => void copy()}>
            {copied ? "Copied" : "Copy details for support"}
          </button>
        </div>
      </div>
    </>
  );
}
