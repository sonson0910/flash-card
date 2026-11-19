import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { Moon, Sun, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Lumi, type LumiPose } from '../../components/lumi/Lumi';
import { readLumiEnabled } from '../settings/lumi-preference';
import { useTheme } from '../theme/ThemeProvider';
import './practice-modes.css';

export type PracticeSegmentState = 'correct' | 'wrong' | 'done' | 'current' | 'pending';

/**
 * Segment states for a run of answers: answered items carry their real
 * outcome when the caller knows it, the active item is "current", and the
 * rest are "pending".
 */
export function practiceSegments(total: number, answered: number, outcomes?: readonly (boolean | undefined)[]): PracticeSegmentState[] {
  return Array.from({ length: Math.max(0, total) }, (_, index) => {
    if (index < answered) {
      const outcome = outcomes?.[index];
      return outcome === true ? 'correct' : outcome === false ? 'wrong' : 'done';
    }
    return index === answered ? 'current' : 'pending';
  });
}

interface PracticeTopBarProps {
  /** Accessible name of the close control, also its visually hidden text. */
  closeLabel: ReactNode;
  onClose: () => void;
  mode: ReactNode;
  detail?: ReactNode;
  /** Omitted for a screen without a run of items, such as a story. */
  progressLabel?: string;
  segments?: readonly PracticeSegmentState[];
  progressValue?: number;
  chip?: ReactNode;
  count?: ReactNode;
  actions?: ReactNode;
  closeAriaLabel?: string;
  /** Holds the close control while a result is being saved. */
  closeDisabled?: boolean;
  /** Crystal prefixes the mode with "Practice //"; a screen with its own heading line can drop it. */
  kicker?: boolean;
}

/** The board header every practice mode draws: close, title, segmented run, chip, count, theme. */
export function PracticeTopBar({
  closeLabel,
  closeAriaLabel,
  closeDisabled = false,
  onClose,
  mode,
  detail,
  progressLabel,
  segments,
  progressValue,
  chip,
  count,
  actions,
  kicker = true,
}: PracticeTopBarProps) {
  const { _ } = useLingui();
  const { mode: themeMode, setMode } = useTheme();
  return (
    <header className="practice-topbar" data-practice-topbar>
      <div className="practice-topbar__start">
        <button
          type="button"
          onClick={onClose}
          disabled={closeDisabled}
          aria-label={closeAriaLabel}
          className="practice-topbar__close crystal-chamfer-sm min-h-11 min-w-11 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none"
        >
          <X size={18} aria-hidden="true" />
          <span className="sr-only">{closeLabel}</span>
        </button>
        <p className="practice-topbar__title">
          {kicker && (
            <span className="practice-topbar__kicker" aria-hidden="true">
              <Trans {...msg({ context: 'practice.topbar.kicker', message: 'Practice' })} />
              <span className="practice-topbar__slashes"> // </span>
            </span>
          )}
          <strong>{mode}</strong>
          {detail && <span className="practice-topbar__detail"> · {detail}</span>}
        </p>
      </div>
      {segments ? (
        <div
          className="practice-topbar__segments"
          role="progressbar"
          aria-label={progressLabel}
          aria-valuemin={0}
          aria-valuemax={segments.length}
          aria-valuenow={progressValue ?? 0}
        >
          {segments.map((state, index) => (
            <i key={index} data-state={state} data-complete={state === 'correct' || state === 'wrong' || state === 'done' ? 'true' : undefined} />
          ))}
        </div>
      ) : <div className="practice-topbar__segments" aria-hidden="true" />}
      <div className="practice-topbar__end">
        {actions}
        {chip}
        {count !== undefined && <span className="practice-topbar__count">{count}</span>}
        <button
          type="button"
          onClick={() => setMode(themeMode === 'dark' ? 'light' : 'dark')}
          aria-pressed={themeMode === 'dark'}
          aria-label={_(msg({ id: 'shell.theme.quick-toggle', message: 'Switch light and dark mode' }))}
          className="practice-topbar__theme crystal-chamfer-sm min-h-11 min-w-11 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none"
        >
          {themeMode === 'dark' ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
        </button>
      </div>
    </header>
  );
}

/** "7 / 10" in the board's mono count style. */
export function PracticeCount({ current, total }: { current: number; total: number }) {
  return (
    <>
      <b>{current}</b>
      <span aria-hidden="true"> / </span>
      <span className="sr-only"> / </span>
      <span>{total}</span>
    </>
  );
}

export function KeyHint({ children }: { children: ReactNode }) {
  return <kbd className="practice-kbd" aria-hidden="true">{children}</kbd>;
}

/** The Enter key cap shown on the button that Enter submits. */
export function EnterKeyHint() {
  return <KeyHint><Trans {...msg({ context: 'practice.key.enter', message: 'Enter' })} /></KeyHint>;
}

/** True when the Crystal family draws Lumi beside the practice board. */
export function useCrystalLumi() {
  return useTheme().family === 'crystal' && readLumiEnabled();
}

interface LumiCoachProps {
  pose: LumiPose;
  heading: ReactNode;
  children?: ReactNode;
  label?: ReactNode;
  className?: string;
}

/** Crystal-only companion: Lumi with a "LUMI · LINK" speech panel built from real card data. */
export function LumiCoach({ pose, heading, children, label, className = '' }: LumiCoachProps) {
  return (
    <div className={`practice-lumi ${className}`} data-practice-lumi>
      <div className="practice-lumi__bubble crystal-chamfer-sm">
        <span className="practice-lumi__label">{label ?? <Trans {...msg({ context: 'practice.lumi.label', message: 'Lumi · Link' })} />}</span>
        <p className="practice-lumi__heading">{heading}</p>
        {children && <div className="practice-lumi__body">{children}</div>}
      </div>
      <Lumi pose={pose} size={180} className="practice-lumi__art crystal-ornament pointer-events-none" />
    </div>
  );
}
