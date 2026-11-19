import * as Dialog from '@radix-ui/react-dialog';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { ArrowRight, Check, Moon, Sun, X } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Lumi } from '../../components/lumi/Lumi';
import { CountUp } from '../../components/motion/CountUp';
import { GsapEntrance } from '../../components/motion/GsapEntrance';
import { formatNumber } from '../../lib/format';
import { triggerHaptic } from '../../lib/haptics';
import { playRewardSound } from '../../lib/interactionSounds';
import { useFocusModePreference } from '../settings/focus-mode-preference';
import { readLumiEnabled } from '../settings/lumi-preference';
import { useTheme } from '../theme/ThemeProvider';
import type { CardData } from '../../types/card';
import { loadTomorrowDueCount } from './session-recap-service';
import './practice-board.css';
import type { StudyReviewSummary } from './practiceSessionLifecycle';

export type SessionRecapTier = 'new' | 'learning' | 'mastered';

/** A card whose committed review in this session raised its library tier. */
export interface SessionRecapPromotion {
  readonly card: CardData;
  readonly from: SessionRecapTier;
  readonly to: SessionRecapTier;
}

interface SessionRecapModalProps {
  open: boolean;
  onClose: () => void;
  onViewWeeklyRecap?: () => void;
  onRetryWeak?: () => void;
  totalCards: number;
  goodCount: number;
  againCount: number;
  xpEarned: number;
  weakCards: CardData[];
  targetLanguage?: string;
  summary?: StudyReviewSummary;
  /** Cards that moved up a tier in this session; only the daily session tracks them. */
  promotions?: readonly SessionRecapPromotion[];
  /** The verified study streak, passed only once today has earned XP. */
  streakDays?: number;
  /** The longest run of remembered cards in a row in this session. */
  bestRun?: number;
  /** Closing returns to Today, so the primary action says so. */
  returnsToToday?: boolean;
  /** Reads how many cards are due tomorrow; defaults to the signed-in learner's library. */
  loadTomorrowDue?: (targetLanguage?: string) => Promise<number>;
}

type TomorrowDueResult = { status: 'loading' | 'ready' | 'error'; count?: number };

const tierRank: Record<SessionRecapTier, number> = { new: 0, learning: 1, mastered: 2 };
const MAX_PROMOTED_CARDS = 3;
const MAX_SEGMENTS = 16;

/** Deterministic confetti so the page renders the same on every visit. */
const confetti = Array.from({ length: 40 }, (_piece, index) => {
  const seed = (value: number) => { const x = Math.sin(value * 12.9898) * 43758.5453; return x - Math.floor(x); };
  return {
    left: Math.round(seed(index + 1) * 100),
    width: 6 + Math.round(seed(index + 7) * 6),
    height: 6 + Math.round(seed(index + 3) * 8),
    delay: Math.round(seed(index + 11) * 2400),
    duration: 3200 + Math.round(seed(index + 5) * 2600),
    rotate: Math.round(seed(index + 9) * 360),
    tone: index % 5,
  };
});

function useTomorrowDue(targetLanguage: string | undefined, load: (targetLanguage?: string) => Promise<number>): TomorrowDueResult {
  const request = useRef<Promise<number> | null>(null);
  const [result, setResult] = useState<TomorrowDueResult>({ status: 'loading' });

  useEffect(() => {
    request.current ??= load(targetLanguage);
    let active = true;
    void request.current.then(
      count => { if (active) setResult({ status: 'ready', count }); },
      () => { if (active) setResult({ status: 'error' }); },
    );
    return () => { active = false; };
  }, [load, targetLanguage]);

  return result;
}

function TomorrowDueText({ result }: { result: TomorrowDueResult }) {
  if (result.status === 'loading') return <Trans {...msg({ context: 'recap.tomorrow-loading', message: 'Checking cards due…' })} />;
  if (result.status === 'error') return <Trans {...msg({ context: 'recap.tomorrow-error', message: 'Count unavailable' })} />;
  return <Trans {...msg({ context: 'recap.tomorrow-count', message: '{count, plural, one {# card due} other {# cards due}}' })} values={{ count: result.count ?? 0 }} />;
}

function TierLabel({ tier, crystal }: { tier: SessionRecapTier; crystal: boolean }) {
  if (crystal) {
    if (tier === 'new') return <Trans {...msg({ context: 'recap.grade.new', message: 'Bud' })} />;
    if (tier === 'learning') return <Trans {...msg({ context: 'recap.grade.learning', message: 'Bloom' })} />;
    return <Trans {...msg({ context: 'recap.grade.mastered', message: 'Star' })} />;
  }
  if (tier === 'new') return <Trans {...msg({ context: 'recap.tier.new', message: 'New' })} />;
  if (tier === 'learning') return <Trans {...msg({ context: 'recap.tier.learning', message: 'Learning' })} />;
  return <Trans {...msg({ context: 'recap.tier.mastered', message: 'Mastered' })} />;
}

function PromotedCard({ promotion, crystal }: { promotion: SessionRecapPromotion; crystal: boolean }) {
  const { card, from, to } = promotion;
  const levels = Math.max(1, tierRank[to] - tierRank[from]);
  return (
    <li className="practice-recap-card" data-tier={to}>
      <div className="practice-recap-card-face">
        {!crystal && (
          <span className="practice-recap-card-art" aria-hidden="true">
            {card.imageUrl ? <img src={card.imageUrl} alt="" loading="lazy" decoding="async" /> : <span>{card.word.charAt(0)}</span>}
          </span>
        )}
        <span className="practice-recap-card-body">
          <strong className="practice-recap-card-word" lang={card.language ?? undefined}>{card.word}</strong>
          <span className="practice-recap-card-meaning" lang={card.translationLanguage ?? undefined}>{card.translation}</span>
          <span className="practice-recap-card-move">
            <span className="sr-only"><Trans {...msg({ context: 'recap.card-move', message: 'Moved from {from} to {to}' })} values={{ from: <TierLabel tier={from} crystal={crystal} />, to: <TierLabel tier={to} crystal={crystal} /> }} /></span>
            <span className="practice-recap-card-from" aria-hidden="true"><TierLabel tier={from} crystal={crystal} /></span>
            <ArrowRight size={crystal ? 14 : 12} strokeWidth={2.4} aria-hidden="true" />
            <span className="practice-recap-card-to" aria-hidden="true"><TierLabel tier={to} crystal={crystal} /></span>
          </span>
        </span>
        {to === 'mastered' && <span className="practice-recap-card-foil" aria-hidden="true" />}
      </div>
      {!crystal && <span className="practice-recap-card-level"><Trans {...msg({ context: 'recap.card-levels', message: '{count, plural, one {+# level} other {+# levels}}' })} values={{ count: levels }} /></span>}
    </li>
  );
}

function StatTile({ label, value, children, tone }: { label: ReactNode; value: ReactNode; children?: ReactNode; tone?: 'holo' | 'crimson' | 'gold' }) {
  return (
    <div className="practice-recap-stat" data-tone={tone}>
      <dt>{label}</dt>
      <dd className="practice-recap-stat-value">{value}</dd>
      {children}
    </div>
  );
}

/** The crimson crystal wing from the canvas partials; the right wing mirrors it. */
const WING_FEATHERS: readonly (readonly [string, string])[] = [
  ['300,300 307.5,279.3 262.2,265 255.5,239.4 202,247.6 193.8,226.3 141.8,230.2 132,213.3 65.1,214.5 159,248.7', '#e0173f'],
  ['300,300 159,248.7 65.1,214.5 164,271.6 294.7,314.5', '#7a0820'],
  ['300,300 318.4,281.6 288.7,253.9 295.4,222.6 244.8,215.7 248.4,187.5 201,177.5 201.5,152.4 157.2,139.4 154.6,117.3 94.9,94.9 177,177', '#e0173f'],
  ['300,300 177,177 94.9,94.9 170.7,203.8 287.1,312.9', '#7a0820'],
  ['300,300 321.9,292.9 305.2,248.4 322.2,227.1 281.6,190.3 294.1,170.5 258.1,132.2 266,113.9 222.7,62.2 253.6,157.3', '#e0173f'],
  ['300,300 253.6,157.3 222.7,62.2 237.8,175.6 284.7,305', '#7a0820'],
  ['300,300 317.7,303.1 324.4,248.8 342.8,239.9 331.5,182.3 344.9,172.5 334.7,103 320.8,181.8', '#e0173f'],
  ['300,300 320.8,181.8 334.7,103 303.1,188.9 287.6,297.8', '#7a0820'],
  ['300,300 297,283.3 246.4,294.9 232.4,281.5 184.8,310.2 171.6,301.5 112.9,333 187.7,319.8', '#e0173f'],
  ['300,300 187.7,319.8 112.9,333 199.7,333.2 302.1,311.7', '#7a0820'],
  ['300,300 311.5,308 333.2,273.2 348.9,273.2 358.9,230.2 371.4,227.9 386,177.1 351.6,226.3', '#e0173f'],
  ['300,300 351.6,226.3 386,177.1 337,225.2 292,294.4', '#7a0820'],
  ['300,300 285.7,280.3 300,242', '#ff5470'],
  ['300,300 300,242 314.3,280.3', '#7a0820'],
  ['300,300 314.3,280.3 355.2,282.1', '#ff5470'],
  ['300,300 355.2,282.1 323.2,307.5', '#7a0820'],
  ['300,300 323.2,307.5 334.1,346.9', '#ff5470'],
  ['300,300 334.1,346.9 300,324.4', '#7a0820'],
  ['300,300 300,324.4 265.9,346.9', '#ff5470'],
  ['300,300 265.9,346.9 276.8,307.5', '#7a0820'],
  ['300,300 276.8,307.5 244.8,282.1', '#ff5470'],
  ['300,300 244.8,282.1 285.7,280.3', '#7a0820'],
];
const WING_SPINES: readonly string[] = [
  '300,300 159,248.7 65.1,214.5',
  '300,300 177,177 94.9,94.9',
  '300,300 253.6,157.3 222.7,62.2',
  '300,300 320.8,181.8 334.7,103',
  '300,300 187.7,319.8 112.9,333',
  '300,300 351.6,226.3 386,177.1',
];

function CrystalWing({ mirrored = false }: { mirrored?: boolean }) {
  return (
    <svg className="practice-recap-wing" data-mirrored={mirrored || undefined} viewBox="0 0 600 400" aria-hidden="true">
      {WING_FEATHERS.map(([points, fill]) => <polygon key={points} points={points} fill={fill} />)}
      {WING_SPINES.map(points => <polyline key={points} points={points} fill="none" stroke="#ffc2cf" strokeWidth={1.4} strokeLinejoin="round" opacity={0.8} />)}
    </svg>
  );
}

/** Crystal hero ornament: the five-point crystal star between two crimson wings, from the canvas partials. */
function CrystalBurst() {
  const star = [
    ['50.0,52.0 38.2,35.7 50.0,4.0', '#ff5470'], ['50.0,52.0 50.0,4.0 61.8,35.7', '#7a0820'], ['50.0,52.0 61.8,35.7 95.7,37.2', '#ff5470'],
    ['50.0,52.0 95.7,37.2 69.2,58.2', '#7a0820'], ['50.0,52.0 69.2,58.2 78.2,90.8', '#ff5470'], ['50.0,52.0 78.2,90.8 50.0,72.2', '#7a0820'],
    ['50.0,52.0 50.0,72.2 21.8,90.8', '#ff5470'], ['50.0,52.0 21.8,90.8 30.8,58.2', '#7a0820'], ['50.0,52.0 30.8,58.2 4.3,37.2', '#ff5470'],
    ['50.0,52.0 4.3,37.2 38.2,35.7', '#7a0820'],
  ] as const;
  return (
    <div className="practice-recap-burst" aria-hidden="true">
      <CrystalWing />
      <CrystalWing mirrored />
      <span className="practice-recap-star">
        <svg viewBox="0 0 100 100">{star.map(([points, fill]) => <polygon key={points} points={points} fill={fill} />)}</svg>
        <span className="practice-recap-star-text"><Trans {...msg({ context: 'recap.grade.mastered', message: 'Star' })} /></span>
      </span>
      <span className="practice-recap-flare" />
    </div>
  );
}

export function SessionRecapModal({
  open, onClose, onViewWeeklyRecap, onRetryWeak, totalCards, goodCount, againCount, xpEarned, weakCards, targetLanguage, summary,
  promotions = [], streakDays, bestRun, returnsToToday = false, loadTomorrowDue = loadTomorrowDueCount,
}: SessionRecapModalProps) {
  const { _ } = useLingui();
  const { family, mode, setMode } = useTheme();
  const { focusModeEnabled } = useFocusModePreference();
  const saved = summary?.saved ?? goodCount + againCount;
  const complete = totalCards > 0 && saved === totalCards;
  const accuracy = saved > 0 ? Math.round((goodCount / saved) * 100) : 0;
  const isCrystal = family === 'crystal';
  const showLumi = isCrystal && readLumiEnabled();
  const tomorrow = useTomorrowDue(targetLanguage, loadTomorrowDue);
  const shownPromotions = promotions.slice(0, MAX_PROMOTED_CARDS);
  const showStreak = typeof streakDays === 'number' && streakDays > 0;
  const showBestRun = !focusModeEnabled && typeof bestRun === 'number' && bestRun >= 2;
  const canRetry = weakCards.length > 0 && Boolean(onRetryWeak);
  const retryDisabled = Boolean(summary?.pending);
  const segments = Math.min(Math.max(saved, 1), MAX_SEGMENTS);
  const goodShare = saved > 0 ? (goodCount / saved) * 100 : 0;

  // The session-finale cue: fires once when the recap is actually reached (this component
  // only mounts/opens at the end of a real session), not on every re-render while it stays open.
  useEffect(() => {
    if (!open || !complete) return;
    playRewardSound();
    triggerHaptic('success');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once per recap arrival, not per prop change
  }, [open, complete]);

  const title = complete
    ? <Trans {...msg({ context: 'recap.title', message: 'Session complete' })} />
    : <Trans {...msg({ context: 'recap.summary-title', message: 'Session summary' })} />;
  const closeLabel = returnsToToday
    ? <Trans {...msg({ context: 'recap.back-today', message: 'Back to Today' })} />
    : <Trans {...msg({ context: 'recap.continue', message: 'Continue learning' })} />;
  const themeToggle = (
    <button type="button" className="practice-recap-icon-button practice-recap-theme" onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')} aria-pressed={mode === 'dark'} aria-label={_(msg({ id: 'shell.theme.quick-toggle', message: 'Switch light and dark mode' }))}>
      {mode === 'dark' ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
    </button>
  );
  const closeButton = (
    <Dialog.Close className="practice-recap-icon-button practice-recap-close" aria-label={_(msg({ id: 'recap.close', message: 'Close recap' }))}>
      <X size={18} aria-hidden="true" />
    </Dialog.Close>
  );
  const progressLine = summary && (
    <p className="practice-recap-progress"><Trans {...msg({ context: 'recap.progress-breakdown', message: 'Saved: {saved} / {total} · Skipped: {skipped} · Not started: {remaining} · Saving: {pending} · Failed: {failed}' })} values={{ ...summary, total: totalCards }} /></p>
  );
  const description = promotions.length > 0
    ? <Trans {...msg({ context: 'recap.description-promoted', message: 'You remembered {good} of {total}, and {promoted, plural, one {# word} other {# words}} moved up a level.' })} values={{ good: goodCount, total: saved, promoted: promotions.length }} />
    : <Trans {...msg({ context: 'recap.description-remembered', message: 'You remembered {good} of {total}.' })} values={{ good: goodCount, total: saved }} />;
  const remembered = <Trans {...msg({ context: 'recap.remembered-count', message: '{count} remembered' })} values={{ count: goodCount }} />;
  const toRevisit = <Trans {...msg({ context: 'recap.revisit-count', message: '{count} to revisit' })} values={{ count: againCount }} />;
  const retryLabel = <Trans {...msg({ context: 'recap.retry-missed', message: '{count, plural, one {Retry the missed word} other {Retry the # missed words}}' })} values={{ count: weakCards.length }} />;

  return (
    <Dialog.Root open={open} onOpenChange={openState => !openState && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="practice-recap-overlay" />
        <Dialog.Content asChild aria-describedby="session-recap-description">
        {/* GSAP's entrance tween takes exclusive ownership of the animated element's `transform`
            inline style while it animates (see GsapEntrance.tsx), so the fixed full-screen frame
            stays a separate, non-animated element and GSAP only moves the board inside it. */}
        <div className="practice-recap-frame">
        <GsapEntrance variant="result" data-session-recap="true" data-family={isCrystal ? 'crystal' : 'classic'} className="practice-recap-board">
          {!isCrystal && (
            <div className="practice-recap-confetti" aria-hidden="true">
              {confetti.map((piece, index) => (
                <span key={index} data-tone={piece.tone} style={{ left: `${piece.left}%`, width: piece.width, height: piece.height, animationDelay: `${piece.delay}ms`, animationDuration: `${piece.duration}ms`, '--recap-confetti-rotate': `${piece.rotate}deg` } as CSSProperties} />
              ))}
            </div>
          )}

          <header className="practice-recap-header">
            {!isCrystal && closeButton}
            {isCrystal && (
              <Dialog.Title className="practice-recap-kicker">
                {showStreak && <span className="practice-recap-kicker-day"><Trans {...msg({ context: 'recap.streak-day', message: 'Day {count}' })} values={{ count: streakDays }} /> <i aria-hidden="true">//</i> </span>}
                {title}
              </Dialog.Title>
            )}
            {!isCrystal && (
              <span className="practice-recap-segments" aria-hidden="true">
                {Array.from({ length: segments }, (_segment, index) => <span key={index} />)}
              </span>
            )}
            {themeToggle}
            {isCrystal && closeButton}
          </header>

          {isCrystal ? (
            <div className="practice-recap-main">
              <div className="practice-recap-hero">
                <CrystalBurst />
                <p className="practice-recap-cheer"><Trans {...msg({ context: 'recap.cheer', message: 'All done!' })} /></p>
              </div>
              <Dialog.Description id="session-recap-description" className="sr-only">{description}</Dialog.Description>

              <dl data-recap-stats className="practice-recap-stats">
                <StatTile tone="holo" label={<Trans {...msg({ context: 'recap.accuracy', message: 'Accuracy' })} />} value={<><CountUp to={accuracy} suffix="%" /><span className="practice-recap-pct" aria-hidden="true">%</span></>}>
                  <p className="practice-recap-stat-sub"><Trans {...msg({ context: 'recap.remembered-of', message: '{good} of {total} remembered' })} values={{ good: goodCount, total: saved }} /></p>
                </StatTile>
                {showBestRun ? (
                  <StatTile tone="crimson" label={<Trans {...msg({ context: 'recap.best-run', message: 'Best combo' })} />} value={<>×{formatNumber(bestRun)}</>}>
                    <p className="practice-recap-stat-sub"><Trans {...msg({ context: 'recap.best-run-detail', message: 'Remembered in a row' })} /></p>
                  </StatTile>
                ) : showStreak ? (
                  <StatTile tone="crimson" label={<Trans {...msg({ context: 'recap.streak', message: 'Streak' })} />} value={formatNumber(streakDays)}>
                    <p className="practice-recap-stat-sub"><Trans {...msg({ context: 'recap.streak-detail', message: 'Days in a row' })} /></p>
                  </StatTile>
                ) : null}
                <StatTile tone="gold" label={<Trans {...msg({ context: 'recap.xp-earned', message: 'XP earned' })} />} value={<><span aria-hidden="true">+</span><CountUp to={xpEarned} /></>}>
                  <p className="practice-recap-stat-sub"><Trans {...msg({ context: 'recap.xp-session', message: 'This session' })} /></p>
                </StatTile>
                <StatTile tone="holo" label={<Trans {...msg({ context: 'recap.words', message: 'Words' })} />} value={<CountUp to={saved} />}>
                  <p className="practice-recap-stat-sub">{toRevisit}</p>
                </StatTile>
              </dl>
              {progressLine}

              {(shownPromotions.length > 0 || weakCards.length > 0) && (
                <div className="practice-recap-panels">
                  {shownPromotions.length > 0 && (
                    <section className="practice-recap-panel practice-recap-panel--up" aria-labelledby="practice-recap-up-heading">
                      <h2 id="practice-recap-up-heading" className="practice-recap-panel-heading"><Trans {...msg({ context: 'recap.cards-up', message: 'Cards glowed up' })} /> <span>// {formatNumber(promotions.length)}</span></h2>
                      <ul className="practice-recap-cards">{shownPromotions.map(promotion => <PromotedCard key={promotion.card.id} promotion={promotion} crystal />)}</ul>
                    </section>
                  )}
                  {weakCards.length > 0 && (
                    <section className="practice-recap-panel practice-recap-panel--revisit" aria-labelledby="practice-recap-revisit-heading">
                      <h2 id="practice-recap-revisit-heading" className="practice-recap-panel-heading"><Trans {...msg({ context: 'recap.needs-review', message: 'To revisit' })} /> <span>// {formatNumber(weakCards.length)}</span></h2>
                      <ul className="practice-recap-weak">{weakCards.map(card => <li key={card.id} lang={card.language ?? 'en'}>{card.word}</li>)}</ul>
                    </section>
                  )}
                </div>
              )}

              <div className="practice-recap-next">
                {showLumi && <Lumi pose="proud" size={112} className="practice-recap-lumi" />}
                <p className="practice-recap-next-label"><Trans {...msg({ context: 'recap.what-next', message: 'What next' })} /></p>
                <div className="practice-recap-next-chips">
                  {canRetry && (
                    <button type="button" className="practice-recap-chip" onClick={onRetryWeak} disabled={retryDisabled}>
                      <span><strong><Trans {...msg({ context: 'recap.review-misses', message: 'Review misses' })} /></strong><small><Trans {...msg({ context: 'recap.card-count', message: '{count, plural, one {# card} other {# cards}}' })} values={{ count: weakCards.length }} /></small></span>
                    </button>
                  )}
                  {onViewWeeklyRecap && (
                    <button type="button" className="practice-recap-chip" onClick={onViewWeeklyRecap}>
                      <span><strong><Trans {...msg({ context: 'recap.weekly', message: 'View weekly recap' })} /></strong><small><Trans {...msg({ context: 'recap.weekly-detail', message: 'Your last 7 days' })} /></small></span>
                    </button>
                  )}
                  <div className="practice-recap-chip practice-recap-chip--status" aria-live="polite">
                    <span><strong><Trans {...msg({ context: 'recap.tomorrow', message: 'Tomorrow' })} /></strong><small><TomorrowDueText result={tomorrow} /></small></span>
                  </div>
                </div>
                <button type="button" className="practice-recap-primary" onClick={onClose}><span>{closeLabel}</span></button>
              </div>
            </div>
          ) : (
            <div className="practice-recap-main">
              <Dialog.Title className="practice-recap-pill"><Check size={14} strokeWidth={2.4} aria-hidden="true" />{title}</Dialog.Title>
              <p className="practice-recap-headline">
                <Trans {...msg({ context: 'recap.headline', message: '{count, plural, one {<0>#</0> word, <1>locked in.</1>} other {<0>#</0> words, <1>locked in.</1>}}' })} values={{ count: saved }} components={{ 0: <CountUp to={saved} />, 1: <em /> }} />
              </p>
              <Dialog.Description id="session-recap-description" className="practice-recap-sub">{description}</Dialog.Description>

              {shownPromotions.length > 0 && (
                <ul className="practice-recap-cards" aria-label={_(msg({ id: 'recap.cards-up-label', message: 'Words that moved up a level' }))}>
                  {shownPromotions.map(promotion => <PromotedCard key={promotion.card.id} promotion={promotion} crystal={false} />)}
                </ul>
              )}

              <dl data-recap-stats className="practice-recap-stats">
                <StatTile label={<Trans {...msg({ context: 'recap.recall', message: 'Recall' })} />} value={<><CountUp to={accuracy} suffix="%" /><span className="practice-recap-pct" aria-hidden="true">%</span></>}>
                  <span className="practice-recap-bar" role="img" aria-label={_({ ...msg({ id: 'recap.recall-split', message: '{good} remembered, {again} to revisit' }), values: { good: goodCount, again: againCount } })}>
                    {againCount > 0 && <span data-part="again" style={{ width: `${100 - goodShare}%` }} />}
                    {goodCount > 0 && <span data-part="good" style={{ width: `${goodShare}%` }} />}
                  </span>
                </StatTile>
                <StatTile label={<Trans {...msg({ context: 'recap.experience', message: 'Experience' })} />} value={<><span aria-hidden="true">+</span><CountUp to={xpEarned} /> <small className="practice-recap-unit">XP</small></>}>
                  <p className="practice-recap-stat-sub">{remembered} · {toRevisit}</p>
                </StatTile>
                {showStreak && (
                  <StatTile label={<Trans {...msg({ context: 'recap.streak', message: 'Streak' })} />} value={<>{formatNumber(streakDays)} <span className="practice-recap-chip-today"><Trans {...msg({ context: 'recap.streak-today', message: '+1 today' })} /></span></>}>
                    <p className="practice-recap-stat-sub"><Trans {...msg({ context: 'recap.streak-note', message: 'A day counts once you earn XP.' })} /></p>
                  </StatTile>
                )}
                <StatTile label={<Trans {...msg({ context: 'recap.next-review', message: 'Next review' })} />} value={<Trans {...msg({ context: 'recap.tomorrow', message: 'Tomorrow' })} />}>
                  <p className="practice-recap-stat-sub" aria-live="polite"><TomorrowDueText result={tomorrow} /></p>
                </StatTile>
              </dl>
              {progressLine}

              <div className="practice-recap-actions">
                <button type="button" className="practice-recap-primary" onClick={onClose}>{closeLabel}</button>
                {canRetry && <button type="button" className="practice-recap-secondary" onClick={onRetryWeak} disabled={retryDisabled}>{retryLabel}</button>}
                {onViewWeeklyRecap && <button type="button" className="practice-recap-link" onClick={onViewWeeklyRecap}><Trans {...msg({ context: 'recap.weekly', message: 'View weekly recap' })} /> <ArrowRight size={15} aria-hidden="true" /></button>}
              </div>
            </div>
          )}
        </GsapEntrance>
        </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
