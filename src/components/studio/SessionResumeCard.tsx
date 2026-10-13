import { useTranslation } from "react-i18next";

type SessionResumeCardProps = {
  title: string;
  detail: string;
  secondaryDetail?: string;
  onResume: () => void;
  onOpenLayout?: () => void;
};

/** A dashboard card for returning to a real saved session or layout. */
export function SessionResumeCard({ title, detail, secondaryDetail, onResume, onOpenLayout }: SessionResumeCardProps) {
  const { t } = useTranslation(["social"]);
  return (
    <article className="dc-studio-session-resume">
      <div className="dc-studio-session-resume-copy">
        <span>{t("social.studio.resume.kicker")}</span>
        <h2>{title}</h2>
        <p>{detail}</p>
        {secondaryDetail && <small>{secondaryDetail}</small>}
      </div>
      <div className="dc-studio-session-resume-actions">
        <button type="button" className="modal-primary" onClick={onResume}>
          {t("social.studio.resume.resume")}
        </button>
        {onOpenLayout && (
          <button type="button" className="modal-secondary" onClick={onOpenLayout}>
            {t("social.studio.resume.openLayout")}
          </button>
        )}
      </div>
    </article>
  );
}
