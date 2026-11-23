import './system-feedback.css';
import lumiSad from '../assets/lumi/lumi-sad.webp';

export const APPLICATION_SUPPORT_HREF = 'mailto:sonlearn155@gmail.com?subject=SonFlash%20issue';

export interface ApplicationErrorPanelProps {
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
  actionBusyLabel?: string;
  isActionBusy?: boolean;
  reportHref?: string;
  reportLabel?: string;
}

export function ApplicationErrorPanel({
  title,
  description,
  actionLabel,
  onAction,
  actionBusyLabel,
  isActionBusy = false,
  reportHref,
  reportLabel,
}: ApplicationErrorPanelProps) {
  return (
    <main className="application-error-screen">
      <section
        className="application-error-panel crystal-chamfer"
        role="alert"
        aria-busy={isActionBusy}
      >
        <div className="application-error-inner">
          <span className="application-error-warning-icon" aria-hidden="true" />
          <div className="application-error-heading-row">
            <img
              src={lumiSad}
              alt=""
              aria-hidden="true"
              width={104}
              height={104}
              loading="lazy"
              data-lumi-pose="sad"
              className="application-error-crystal-lumi crystal-ornament"
            />
            <h1>
              {title.lastIndexOf(' ') > 0 ? <>
                {title.slice(0, title.lastIndexOf(' '))}{' '}
                <span className="application-error-title-emphasis">{title.slice(title.lastIndexOf(' ') + 1)}</span>
              </> : title}
            </h1>
          </div>
          <p>{description}</p>
          <span className="application-error-lightning" aria-hidden="true" />
          <div className="application-error-actions">
            <button type="button" onClick={onAction} disabled={isActionBusy}>
              {isActionBusy && actionBusyLabel ? actionBusyLabel : actionLabel}
            </button>
            {reportHref && reportLabel ? <a href={reportHref}>{reportLabel}</a> : null}
          </div>
        </div>
      </section>
    </main>
  );
}
