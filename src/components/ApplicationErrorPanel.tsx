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
          <span className="application-error-warning-icon" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3 2 20h20zM12 10v4M12 17h.01" />
            </svg>
          </span>
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
          <svg className="application-error-lightning" aria-hidden="true" width="210" height="120" viewBox="0 0 210 120">
            <path d="M210 10 L170 30 L182 44 L130 66 L142 82 L96 104" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M170 30 L156 12 M130 66 L112 52 M142 82 L166 104" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.8" />
          </svg>
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
