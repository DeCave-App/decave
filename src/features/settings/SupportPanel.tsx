import { useState } from "react";
import { useSettingsT } from "./useSettingsT";

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

const SUPPORT_EMAIL = "support@de-cave.com";
const SERVICE_HOST = "app.de-cave.com";
const LEGAL_LINKS = [
  { key: "privacy", url: "https://de-cave.com/privacy" },
  { key: "terms", url: "https://de-cave.com/terms" },
] as const;

/** Settings → App & about: get help, report a bug with the details filled in, see what's new. */
export function SupportPanel({
  appName,
  version,
  platform,
  username,
  canOpenMail,
  onOpenPatchNotes,
  openExternal,
}: Props) {
  const { t } = useSettingsT();
  const [copied, setCopied] = useState(false);
  const [copiedTemplate, setCopiedTemplate] = useState("");
  // Diagnostic lines for the support team stay in English.
  const details = [
    `App: ${appName} ${version}`,
    `Platform: ${platform}`,
    `Browser: ${typeof navigator !== "undefined" ? navigator.userAgent : "unknown"}`,
    `Account: ${username}`,
    `Time: ${new Date().toISOString()}`,
  ].join("\n");
  const mail = (subject: string, intro: string) =>
    `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`${intro}\n\n\n---\n${details}\n`)}`;
  const copyTemplate = async (id: string, intro: string) => {
    try {
      await navigator.clipboard.writeText(`To: ${SUPPORT_EMAIL}\n\n${intro}\n\n\n---\n${details}\n`);
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
            ? t("settings.support.copiedTemplate", { email: SUPPORT_EMAIL })
            : t("settings.support.copiesTemplate", { detail })}
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
      <div className="dcs-support-grid" data-settings-anchor="support">
        {tile(
          "bug",
          "DeCave bug report",
          t("settings.support.bugTemplate"),
          t("settings.support.bug"),
          t("settings.support.bugHelp"),
        )}
        {tile(
          "help",
          "DeCave support request",
          t("settings.support.helpTemplate"),
          t("settings.support.contact"),
          t("settings.support.contactHelp"),
        )}
        <button
          type="button"
          className="dcs-support-tile"
          data-settings-anchor="whats-new"
          disabled={!onOpenPatchNotes}
          onClick={() => onOpenPatchNotes?.()}
        >
          <strong>{t("settings.support.whatsNew")}</strong>
          <small>{onOpenPatchNotes ? t("settings.support.whatsNewHelp") : t("settings.support.whatsNewJoin")}</small>
        </button>
      </div>
      <div className="dcs-card">
        <dl className="dcs-about">
          <div>
            <dt>{t("settings.support.about.app")}</dt>
            <dd>{appName}</dd>
          </div>
          <div>
            <dt>{t("settings.support.about.version")}</dt>
            <dd data-installed-version={version}>{version}</dd>
          </div>
          <div>
            <dt>{t("settings.support.about.platform")}</dt>
            <dd>{platform}</dd>
          </div>
          <div>
            <dt>{t("settings.support.about.service")}</dt>
            <dd>{SERVICE_HOST}</dd>
          </div>
          <div>
            <dt>{t("settings.support.about.email")}</dt>
            <dd>{SUPPORT_EMAIL}</dd>
          </div>
          <div>
            <dt>{t("settings.support.about.legal")}</dt>
            <dd className="dcs-legal-links">
              {LEGAL_LINKS.map(({ key, url }, index) => {
                const label = key === "privacy" ? t("settings.support.privacy") : t("settings.support.terms");
                return (
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
                );
              })}
            </dd>
          </div>
        </dl>
        <div className="dcs-card-actions">
          <button type="button" className="modal-secondary" onClick={() => void copy()}>
            {copied ? t("settings.support.copied") : t("settings.support.copyDetails")}
          </button>
        </div>
      </div>
    </>
  );
}
