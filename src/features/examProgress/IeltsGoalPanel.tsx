import { useId } from 'react';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { useTheme } from '../theme/ThemeProvider';
import type { IeltsGoalModel } from './ieltsGoalModel';
import { useIeltsGoalProgress, type IeltsGoalProgressOptions } from './useIeltsGoalProgress';
import './ielts-goal-panel.css';

const RING_RADIUS = 44;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export interface IeltsGoalPanelActions {
  /** Opens the IELTS path in Paths. */
  readonly onOpenPath: () => void;
  /** Opens the course goal editor with the band picker; the link is left out when absent. */
  readonly onSetTargetBand?: () => void;
  /** Opens the latest score editor; the link is left out when absent. */
  readonly onEditLatestScore?: () => void;
}

export interface IeltsGoalPanelViewProps extends IeltsGoalPanelActions {
  readonly model: IeltsGoalModel;
}

const formatExamDate = (locale: string, examDate: string, withYear: boolean): string => {
  const [year, month, day] = examDate.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
};

function BandArrow() {
  return (
    <svg className="ielts-goal-band__arrow" width="30" height="12" viewBox="0 0 30 12" fill="none" aria-hidden="true">
      <path d="M1 6h27M23 1l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** "6.5 → 7.0" with a spoken form ("from 6.5 to 7.0"); both values are entered by the learner. */
function BandPair({ latest, target }: { readonly latest: string; readonly target: string }) {
  const { _ } = useLingui();
  return (
    <span className="ielts-goal-band__pair">
      <span className="sr-only">{_({ ...msg({ id: 'exam-progress.band-pair.spoken', message: 'from {latest} to {target}' }), values: { latest, target } })}</span>
      <span className="ielts-goal-band__values" aria-hidden="true">
        <span className="ielts-goal-band__latest">{latest}</span>
        <BandArrow />
        <span className="ielts-goal-band__target">{target}</span>
      </span>
    </span>
  );
}

function PanelLink({ onClick, children }: { readonly onClick: () => void; readonly children: string }) {
  return <button type="button" className="ielts-goal-panel__link" onClick={onClick}>{children}</button>;
}

function OpenPathPrompt({ onOpenPath }: { readonly onOpenPath: () => void }) {
  const { _ } = useLingui();
  return (
    <div className="ielts-goal-panel__prompt">
      <p>{_(msg({ id: 'exam-progress.not-started', message: 'Start the SonFlash IELTS path to see your progress here.' }))}</p>
      <button type="button" className="ielts-goal-panel__button" onClick={onOpenPath}>
        {_(msg({ id: 'exam-progress.open-path', message: 'Open the IELTS path' }))}
      </button>
    </div>
  );
}

function ClassicPanel({ model, onOpenPath, onSetTargetBand, onEditLatestScore, headingId }: IeltsGoalPanelViewProps & { readonly headingId: string }) {
  const { _, i18n } = useLingui();
  const dash = (model.percent / 100) * RING_CIRCUMFERENCE;
  return (
    <>
      <h2 id={headingId} className="ielts-goal-panel__heading">{_(msg({ id: 'exam-progress.classic.heading', message: 'Toward your IELTS goal' }))}</h2>
      {model.state === 'not-started' ? <OpenPathPrompt onOpenPath={onOpenPath} /> : (
        <div className="ielts-goal-panel__progress">
          <div
            className="ielts-goal-ring"
            role="img"
            aria-label={_({ ...msg({ id: 'exam-progress.ring.label', message: '{percent}% of the SonFlash IELTS path mastered' }), values: { percent: model.percent } })}
          >
            <svg width="104" height="104" viewBox="0 0 104 104" aria-hidden="true">
              <circle className="ielts-goal-ring__track" cx="52" cy="52" r={RING_RADIUS} fill="none" strokeWidth="8" />
              <circle
                className="ielts-goal-ring__value"
                cx="52"
                cy="52"
                r={RING_RADIUS}
                fill="none"
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={`${dash.toFixed(2)} ${RING_CIRCUMFERENCE.toFixed(2)}`}
              />
            </svg>
            <span className="ielts-goal-ring__percent" aria-hidden="true" data-percent={model.percent}>
              {_({ ...msg({ id: 'exam-progress.ring.percent', message: '{percent}%' }), values: { percent: model.percent } })}
            </span>
          </div>
          <p className="ielts-goal-panel__summary" data-mastered={model.mastered} data-total={model.total}>
            {_({ ...msg({ id: 'exam-progress.classic.summary', message: "You've mastered {mastered} of the {total, plural, one {# word} other {# words}} in the SonFlash IELTS path." }), values: { mastered: model.mastered, total: model.total } })}
            {model.masteredThisWeek !== null && model.masteredThisWeek > 0 && (
              <span className="ielts-goal-panel__week">
                {' '}
                {_({ ...msg({ id: 'exam-progress.classic.week', message: '{count, plural, one {+# word this week.} other {+# words this week.}}' }), values: { count: model.masteredThisWeek } })}
              </span>
            )}
          </p>
        </div>
      )}
      {(model.targetBand !== null || onSetTargetBand) && <div className="ielts-goal-band">
        {model.targetBand === null ? (
          onSetTargetBand && <PanelLink onClick={onSetTargetBand}>{_(msg({ id: 'exam-progress.set-target', message: 'Set a target band' }))}</PanelLink>
        ) : (
          <>
            <span className="ielts-goal-band__label">
              {model.latestScore !== null
                ? _(msg({ id: 'exam-progress.band.label', message: 'Your score to your target' }))
                : _(msg({ id: 'exam-progress.band.target-label', message: 'Your target' }))}
            </span>
            {model.latestScore !== null
              ? <BandPair latest={model.latestScore} target={model.targetBand} />
              : <span className="ielts-goal-band__target">{_({ ...msg({ id: 'exam-progress.band.target', message: 'Band {target}' }), values: { target: model.targetBand } })}</span>}
            {model.examDate !== null && (
              <span className="ielts-goal-band__date">
                {_({ ...msg({ id: 'exam-progress.band.by-date', message: 'by {date}' }), values: { date: formatExamDate(i18n.locale, model.examDate, !model.examThisYear) } })}
              </span>
            )}
            {model.latestScore === null && onEditLatestScore && (
              <PanelLink onClick={onEditLatestScore}>{_(msg({ id: 'exam-progress.add-latest', message: 'Add your latest score' }))}</PanelLink>
            )}
          </>
        )}
      </div>}
      <p className="ielts-goal-panel__footnote">
        {_(msg({ id: 'exam-progress.classic.footnote', message: "Based on words you've mastered in SonFlash. Not an IELTS score or a prediction." }))}
      </p>
    </>
  );
}

function CrystalPanel({ model, onOpenPath, onSetTargetBand, onEditLatestScore, headingId }: IeltsGoalPanelViewProps & { readonly headingId: string }) {
  const { _ } = useLingui();
  return (
    <>
      <h2 id={headingId} className="ielts-goal-panel__heading">{_(msg({ id: 'exam-progress.crystal.heading', message: 'IELTS goal' }))}</h2>
      {(model.targetBand !== null || onSetTargetBand) && <div className="ielts-goal-band">
        {model.targetBand === null ? (
          onSetTargetBand && <PanelLink onClick={onSetTargetBand}>{_(msg({ id: 'exam-progress.set-target', message: 'Set a target band' }))}</PanelLink>
        ) : model.latestScore !== null ? (
          <>
            <BandPair latest={model.latestScore} target={model.targetBand} />
            <span className="ielts-goal-band__label">{_(msg({ id: 'exam-progress.band.label', message: 'Your score to your target' }))}</span>
          </>
        ) : (
          <>
            <span className="ielts-goal-band__target">{_({ ...msg({ id: 'exam-progress.crystal.target', message: 'Target {target}' }), values: { target: model.targetBand } })}</span>
            {onEditLatestScore && <PanelLink onClick={onEditLatestScore}>{_(msg({ id: 'exam-progress.add-latest', message: 'Add your latest score' }))}</PanelLink>}
          </>
        )}
      </div>}
      {model.state === 'not-started' ? <OpenPathPrompt onOpenPath={onOpenPath} /> : (
        <>
          <div
            className="ielts-goal-bar"
            role="progressbar"
            aria-label={_(msg({ id: 'exam-progress.bar.label', message: 'IELTS path words mastered' }))}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={model.percent}
            aria-valuetext={_({ ...msg({ id: 'exam-progress.ring.percent', message: '{percent}%' }), values: { percent: model.percent } })}
          >
            <span className="ielts-goal-bar__fill" style={{ width: `${model.percent}%` }} />
          </div>
          <p className="ielts-goal-panel__summary" data-mastered={model.mastered} data-total={model.total}>
            {_({ ...msg({ id: 'exam-progress.crystal.summary', message: '{mastered} of {total} IELTS path words are mastered in your deck.' }), values: { mastered: model.mastered, total: model.total } })}
            {model.daysToExam !== null && <>{' '}{_({ ...msg({ id: 'exam-progress.crystal.exam-days', message: '{days, plural, one {Exam in # day.} other {Exam in # days.}}' }), values: { days: model.daysToExam } })}</>}
          </p>
        </>
      )}
      <p className="ielts-goal-panel__footnote">{_(msg({ id: 'exam-progress.crystal.footnote', message: 'Vocabulary progress, not an IELTS score.' }))}</p>
    </>
  );
}

/** The IELTS goal panel from a ready model: classic ring or Crystal bar, by the active theme family. */
export function IeltsGoalPanelView(props: IeltsGoalPanelViewProps) {
  const { family } = useTheme();
  const headingId = useId();
  return (
    <section className={`ielts-goal-panel ielts-goal-panel--${family} ielts-goal-panel--${props.model.state} crystal-chamfer`} aria-labelledby={headingId} data-ielts-goal-panel={props.model.state}>
      {family === 'crystal' ? <CrystalPanel {...props} headingId={headingId} /> : <ClassicPanel {...props} headingId={headingId} />}
    </section>
  );
}

export type IeltsGoalPanelProps = IeltsGoalProgressOptions & IeltsGoalPanelActions;

/**
 * Loads its own data and renders nothing until the progress is ready. It renders nothing at all
 * when the active goal is not IELTS, the IELTS path is not installed, the app is offline, or the
 * read fails, so the surrounding layout closes up.
 */
export function IeltsGoalPanel({ onOpenPath, onSetTargetBand, onEditLatestScore, ...options }: IeltsGoalPanelProps) {
  const progress = useIeltsGoalProgress(options);
  if (progress.status !== 'ready') return null;
  return (
    <IeltsGoalPanelView
      model={progress.model}
      onOpenPath={onOpenPath}
      onSetTargetBand={onSetTargetBand}
      onEditLatestScore={onEditLatestScore}
    />
  );
}
