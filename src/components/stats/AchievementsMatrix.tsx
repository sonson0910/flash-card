import { ArrowLeft, Award, Check, Flame, Lock, Moon, Sparkles, Target, Trophy } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { formatNumber } from '../../lib/format';
import { Lumi } from '../lumi/Lumi';
import { CrystalStar } from './CrystalStar';
import { CrystalPathWings } from '../../features/catalogWorkspace/CrystalPathWings';
import { useTheme } from '../../features/theme/ThemeProvider';
import { readLumiEnabled } from '../../features/settings/lumi-preference';
import type { LibraryStatsViewModel } from '../../features/library/libraryViewModel';
import { sessionsToNextLevel } from '../../features/dailyLearning/todayScreenFacts';
import { achievementsLevelFacts, useAchievementsLearner } from './AchievementsMatrixLearner';
import './stats-board.css';
import './achievements-board.css';

interface AchievementsMatrixProps {
  stats: LibraryStatsViewModel;
  readonly onBackToProgress?: () => void;
}

/** Visual/eligibility state of a badge, derived only from real progress numbers — no invented gating conditions. */
export type AchievementBadgeVisualState = 'earned' | 'in-progress' | 'locked';

/** Stable, locale-independent grouping key for the "nhóm tier" (tier grouping) requirement. */
export type AchievementBadgeTierKey = 'bud' | 'bloom' | 'star';

type BadgeUnitKind = 'days' | 'words' | 'xp';

interface Badge { id: string; title: string; description: string; tier: string; tierKey: AchievementBadgeTierKey; icon: typeof Trophy; unlocked: boolean; progress: number; current: number; target: number; unit: string; unitKind: BadgeUnitKind; state: AchievementBadgeVisualState; }

/**
 * A badge is `earned` once unlocked, `in-progress` once the learner has made any real progress
 * toward it, and `locked` only when there is no progress signal yet (current === 0). This never
 * invents a prerequisite/gate — every badge here is always achievable — it just distinguishes
 * "not started" from "actively working on it" so the grid can show three distinct Canvas states.
 */
export function resolveAchievementBadgeState(stat: Pick<AchievementBadgeStat, 'unlocked' | 'current'>): AchievementBadgeVisualState {
  if (stat.unlocked) return 'earned';
  return stat.current > 0 ? 'in-progress' : 'locked';
}

/** Numeric identity of every milestone badge, stable across locales and callers. */
export type AchievementBadgeId = 'streak_3' | 'mastery_10' | 'mastery_50' | 'xp_100' | 'xp_total_500' | 'night_owl';

export interface AchievementBadgeStat {
  readonly id: AchievementBadgeId;
  readonly unlocked: boolean;
  readonly progress: number;
  readonly current: number;
  readonly target: number;
}

/**
 * Locale-independent badge math shared by the Progress achievements grid and
 * the weekly recap milestones strip, so both read the exact same thresholds
 * from the exact same `LibraryStatsViewModel` instead of drifting apart.
 */
export function computeAchievementBadgeStats(stats: LibraryStatsViewModel): AchievementBadgeStat[] {
  const totalXp = stats.xpChartData.reduce((sum, item) => sum + item.XP, 0);
  const maxSingleDayXp = Math.max(0, ...stats.xpChartData.map(item => item.XP));
  const activeDays = stats.xpChartData.filter(item => item.XP > 0).length;
  return [
    { id: 'streak_3', unlocked: activeDays >= 3, progress: Math.min(100, Math.round(activeDays / 3 * 100)), current: activeDays, target: 3 },
    { id: 'mastery_10', unlocked: stats.reviewed >= 10, progress: Math.min(100, Math.round(stats.reviewed / 10 * 100)), current: stats.reviewed, target: 10 },
    { id: 'mastery_50', unlocked: stats.learned >= 50, progress: Math.min(100, Math.round(stats.learned / 50 * 100)), current: stats.learned, target: 50 },
    { id: 'xp_100', unlocked: maxSingleDayXp >= 100, progress: Math.min(100, Math.round(maxSingleDayXp / 100 * 100)), current: maxSingleDayXp, target: 100 },
    { id: 'xp_total_500', unlocked: totalXp >= 500, progress: Math.min(100, Math.round(totalXp / 500 * 100)), current: totalXp, target: 500 },
    { id: 'night_owl', unlocked: activeDays >= 5, progress: Math.min(100, Math.round(activeDays / 5 * 100)), current: activeDays, target: 5 },
  ];
}

const text = {
  bud: msg({ id: 'stats.tier-bud', message: 'Bud' }), bloom: msg({ id: 'stats.tier-bloom', message: 'Bloom' }), star: msg({ id: 'stats.tier-star', message: 'Star' }),
  days: msg({ id: 'stats.days', message: 'days' }), words: msg({ id: 'stats.words', message: 'words' }), unlocked: msg({ id: 'stats.unlocked', message: 'unlocked' }), progress: msg({ id: 'stats.progress', message: 'Progress' }),
  reviewed: msg({ id: 'stats.reviewed', message: 'Reviewed' }), mastered: msg({ id: 'stats.mastered', message: 'Mastered' }), learning: msg({ id: 'stats.learning', message: 'Learning' }), notReviewed: msg({ id: 'stats.not-reviewed', message: 'Not reviewed' }),
  gradeMastered: msg({ id: 'stats.grade-mastered', message: 'Star' }), gradeLearning: msg({ id: 'stats.grade-learning', message: 'Bloom' }), gradeNew: msg({ id: 'stats.grade-new', message: 'Bud' }),
  studyXp: msg({ id: 'stats.study-xp', message: 'Study XP' }), badges: msg({ id: 'stats.badges', message: 'Badges' }), earned: msg({ id: 'stats.earned', message: 'Earned' }), starTier: msg({ id: 'stats.legend.star-tier', message: 'Star tier' }),
  cardsByBloom: msg({ id: 'stats.cards-by-bloom', message: 'Cards by bloom' }), lumiLink: msg({ id: 'stats.lumi-link', message: 'Lumi · Link' }),
  inProgress: msg({ id: 'stats.badge-state.in-progress', message: 'In progress' }), locked: msg({ id: 'stats.badge-state.locked', message: 'Not started yet' }), legendLabel: msg({ id: 'stats.legend.label', message: 'Badge status legend' }),
  budRoutine: msg({ id: 'stats.bud-routine', message: 'Bud routine' }), budRoutineDescription: msg({ id: 'stats.bud-routine-description', message: 'Give your study habit three active days.' }),
  bloomingRecall: msg({ id: 'stats.blooming-recall', message: 'Blooming recall' }), bloomingRecallDescription: msg({ id: 'stats.blooming-recall-description', message: 'Help ten words settle into memory.' }),
  starKeeper: msg({ id: 'stats.star-keeper', message: 'Star keeper' }), starKeeperDescription: msg({ id: 'stats.star-keeper-description', message: 'Help fifty words shine as mastered.' }),
  brightStudyDay: msg({ id: 'stats.bloom-day', message: 'Bright study day' }), brightStudyDayDescription: msg({ id: 'stats.bloom-day-description', message: 'Gather 100 XP in one day of practice.' }),
  growingCollection: msg({ id: 'stats.star-collection', message: 'Growing collection' }), growingCollectionDescription: msg({ id: 'stats.star-collection-description', message: 'Collect 500 XP from your study sessions.' }),
  gentleNightStudy: msg({ id: 'stats.bud-night-study', message: 'Gentle night study' }), gentleNightStudyDescription: msg({ id: 'stats.bud-night-study-description', message: 'Return for five active study days.' }),
  studyMilestones: msg({ id: 'stats.study-milestones', message: 'Study milestones' }), achievements: msg({ id: 'stats.achievements', message: 'Achievements' }), backToProgress: msg({ id: 'stats.back-to-progress', message: 'Back to Progress' }),
  allEarned: msg({ id: 'stats.all-badges-earned', message: 'Every badge is unlocked' }),
};

const wordGardenTitle = msg({ id: 'stats.word-garden-title', message: 'Your word <0>garden</0>' });
const nextBadgeMeter = msg({ id: 'stats.next-badge-meter', message: '<0>{current}</0> / {target} {unit} toward {badge}' });
const remainingCopy = {
  days: msg({ id: 'stats.remaining-days', message: '{count, plural, one {# day} other {# days}}' }),
  words: msg({ id: 'stats.remaining-words', message: '{count, plural, one {# word} other {# words}}' }),
  xp: msg({ id: 'stats.remaining-xp', message: '{count} XP' }),
} satisfies Record<BadgeUnitKind, ReturnType<typeof msg>>;
const earnedCount = msg({ id: 'stats.earned-count', message: '{earned} of {total} earned' });
const levelLabel = msg({ id: 'stats.level', message: 'Level' });
const levelMeter = msg({ id: 'stats.level-meter', message: '<0>{xp}</0> / {next} XP to Level {level}' });
const levelSessions = msg({ id: 'stats.level-sessions', message: '≈ {count, plural, one {# session} other {# sessions}}' });
const crystalLevelLine = msg({ id: 'stats.level-line', message: 'Lv {level} · {xp} / {next} XP' });
const lumiNextCopy = msg({ id: 'stats.lumi-next', message: '{remaining} to go for <0>{badge}</0>.' });
const lumiDoneCopy = msg({ id: 'stats.lumi-done', message: 'Every badge is in bloom. Wonderful work!' });

export function findNewlyUnlockedBadgeIds(previous: ReadonlySet<string>, current: ReadonlySet<string>): string[] {
  return [...current].filter(id => !previous.has(id));
}

/** Localized copy for each badge, keyed by the same id `computeAchievementBadgeStats` returns. */
export const achievementBadgeCopy: Record<AchievementBadgeId, {
  title: ReturnType<typeof msg>; description: ReturnType<typeof msg>; tier: ReturnType<typeof msg>; tierKey: AchievementBadgeTierKey; icon: typeof Trophy; unit: ReturnType<typeof msg> | 'XP';
}> = {
  streak_3: { title: text.budRoutine, description: text.budRoutineDescription, tier: text.bud, tierKey: 'bud', icon: Flame, unit: text.days },
  mastery_10: { title: text.bloomingRecall, description: text.bloomingRecallDescription, tier: text.bloom, tierKey: 'bloom', icon: Sparkles, unit: text.words },
  mastery_50: { title: text.starKeeper, description: text.starKeeperDescription, tier: text.star, tierKey: 'star', icon: Trophy, unit: text.words },
  xp_100: { title: text.brightStudyDay, description: text.brightStudyDayDescription, tier: text.bloom, tierKey: 'bloom', icon: Target, unit: 'XP' },
  xp_total_500: { title: text.growingCollection, description: text.growingCollectionDescription, tier: text.star, tierKey: 'star', icon: Award, unit: 'XP' },
  night_owl: { title: text.gentleNightStudy, description: text.gentleNightStudyDescription, tier: text.bud, tierKey: 'bud', icon: Moon, unit: text.days },
};

const unitKindOf = (unit: ReturnType<typeof msg> | 'XP'): BadgeUnitKind => unit === 'XP' ? 'xp' : unit === text.days ? 'days' : 'words';

/** Ring circumference for the 66px radius of the summary ring. */
const RING_CIRCUMFERENCE = 2 * Math.PI * 66;

/** A badge's progress toward its target, shown no higher than the target once it is unlocked. */
const shownCurrent = (badge: Badge) => Math.min(badge.current, badge.target);

function Medal({ badge, index }: { readonly badge: Badge; readonly index: number }) {
  const Icon = badge.icon;
  const tilt = badge.state === 'earned' ? (index % 3 - 1) * 4 : 0;
  return <span className="ach-medal" aria-hidden="true" style={{ '--ach-tilt': `${tilt}deg` } as CSSProperties}><Icon size={28} strokeWidth={1.8} /></span>;
}

function BadgeFoot({ badge, isCrystal }: { readonly badge: Badge; readonly isCrystal: boolean }) {
  const { _ } = useLingui();
  if (isCrystal) {
    return <div className="ach-badge-meter">
      <span className="ach-track" aria-hidden="true"><span className="ach-fill" style={{ width: `${badge.progress}%` }} /></span>
      <span className="ach-badge-ratio tabular-nums">{formatNumber(shownCurrent(badge))}/{formatNumber(badge.target)}<span className="sr-only"> {badge.unit}{badge.state === 'locked' ? ` · ${_(text.locked)}` : ''}</span></span>
    </div>;
  }
  if (badge.state === 'earned') return <p className="ach-badge-earned"><Check size={12} strokeWidth={2.4} aria-hidden="true" />{_(text.earned)}</p>;
  if (badge.state === 'locked') return <p className="ach-badge-locked"><Lock size={11} strokeWidth={2.2} aria-hidden="true" />{_(text.locked)}</p>;
  return <>
    <div className="ach-badge-count"><span className="tabular-nums">{formatNumber(badge.current)} / {formatNumber(badge.target)} {badge.unit}</span><span className="tabular-nums">{formatNumber(badge.progress)}%</span></div>
    <span className="ach-track" aria-hidden="true"><span className="ach-fill transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${badge.progress}%` }} /></span>
  </>;
}

function BadgeCard({ badge, index, isCrystal, isNewlyUnlocked }: { readonly badge: Badge; readonly index: number; readonly isCrystal: boolean; readonly isNewlyUnlocked: boolean }) {
  const { _ } = useLingui();
  return <article data-badge-id={badge.id} data-newly-unlocked={isNewlyUnlocked || undefined} data-badge-state={badge.state} data-badge-tier={badge.tierKey} className={`ach-badge ${isNewlyUnlocked ? 'achievement-newly-unlocked' : ''}`}>
    <div className="ach-badge-head">
      <Medal badge={badge} index={index} />
      <div className="ach-badge-name"><h3 className="ach-badge-title">{badge.title}</h3><span className="ach-badge-tier">{badge.tier}</span></div>
    </div>
    <p className="ach-badge-desc">{badge.description}</p>
    <div className="ach-badge-foot"><BadgeFoot badge={badge} isCrystal={isCrystal} /></div>
    {!isCrystal && badge.state === 'earned' && badge.tierKey === 'star' && <span className="ach-badge-sheen" aria-hidden="true" />}
    {isCrystal && badge.state === 'locked' && <span className="ach-badge-veil" aria-hidden="true">
      <svg viewBox="0 0 200 120" preserveAspectRatio="none" focusable="false"><polyline className="ach-veil-line" points="0,64 30,52 52,72 84,44 106,66 132,40 158,62 200,48" /><polyline className="ach-veil-spark" points="84,44 90,18 110,4" /></svg>
      <span className="ach-badge-veil-chip">{_(text.locked)}</span>
    </span>}
  </article>;
}

export function AchievementsMatrix({ stats, onBackToProgress }: AchievementsMatrixProps) {
  const { _ } = useLingui();
  const { family } = useTheme();
  const isCrystal = family === 'crystal';
  const badgeStats = computeAchievementBadgeStats(stats);
  const badges: Badge[] = badgeStats.map(stat => {
    const copy = achievementBadgeCopy[stat.id];
    return {
      id: stat.id,
      title: _(copy.title),
      description: _(copy.description),
      tier: _(copy.tier),
      tierKey: copy.tierKey,
      icon: copy.icon,
      unlocked: stat.unlocked,
      progress: stat.progress,
      current: stat.current,
      target: stat.target,
      unit: copy.unit === 'XP' ? 'XP' : _(copy.unit),
      unitKind: unitKindOf(copy.unit),
      state: resolveAchievementBadgeState(stat),
    };
  });
  const unlockedIds = new Set(badges.filter(badge => badge.unlocked).map(badge => badge.id));
  const allEarned = unlockedIds.size === badges.length;
  const featuredBadge = badges.find(badge => badge.state === 'in-progress') ?? badges.find(badge => !badge.unlocked) ?? badges[0];
  const unlockedSignature = [...unlockedIds].join('|');
  const previousUnlockedRef = useRef<Set<string> | null>(null);
  const [celebratingIds, setCelebratingIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    const previous = previousUnlockedRef.current;
    const current = new Set(unlockedSignature ? unlockedSignature.split('|') : []);
    previousUnlockedRef.current = current;
    if (!previous) return;
    const newlyUnlocked = findNewlyUnlockedBadgeIds(previous, current);
    setCelebratingIds(new Set(newlyUnlocked));
    if (newlyUnlocked.length === 0) return;
    const timeout = globalThis.setTimeout(() => setCelebratingIds(new Set()), 900);
    return () => globalThis.clearTimeout(timeout);
  }, [unlockedSignature]);
  const celebrationMessage = badges.filter(badge => celebratingIds.has(badge.id)).map(badge => `${badge.title} ${_(text.unlocked)}`).join('. ');

  const unlockedPercent = Math.round(unlockedIds.size / badges.length * 100);
  const studyXp = stats.xpChartData.reduce((sum, item) => sum + item.XP, 0);
  // The verified level from the app runtime, when the board is shown to a signed-in learner.
  const levelFacts = achievementsLevelFacts(useAchievementsLearner());
  const sessionsLeft = levelFacts ? sessionsToNextLevel(levelFacts.remaining, stats.xpChartData) : null;
  const kicker = <p className="ach-kicker">{onBackToProgress ? _(text.achievements) : _(text.studyMilestones)} · {_({ ...earnedCount, values: { earned: formatNumber(unlockedIds.size), total: formatNumber(badges.length) } })}</p>;
  const heading = <h1 id="achievements-heading" className="ach-title text-balance"><Trans {...wordGardenTitle} components={{ 0: <em className="ach-title-accent" /> }} /></h1>;
  const backButton = onBackToProgress && <button type="button" onClick={onBackToProgress} className="ach-back crystal-chamfer-sm inline-flex min-h-11 cursor-pointer items-center gap-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)] motion-reduce:transition-none"><ArrowLeft size={16} aria-hidden="true" />{_(text.backToProgress)}</button>;
  const grid = <div data-achievement-grid className="ach-grid">{badges.map((badge, index) => <BadgeCard key={badge.id} badge={badge} index={index} isCrystal={isCrystal} isNewlyUnlocked={celebratingIds.has(badge.id)} />)}</div>;

  if (isCrystal) {
    const bloomRows = [
      { kind: 'new', grade: _(text.gradeNew), label: _(text.notReviewed), count: stats.difficultyChart.find(entry => entry.name === 'Not reviewed')?.value ?? 0 },
      { kind: 'learning', grade: _(text.gradeLearning), label: _(text.learning), count: stats.difficultyChart.find(entry => entry.name === 'Learning')?.value ?? 0 },
      { kind: 'mastered', grade: _(text.gradeMastered), label: _(text.mastered), count: stats.difficultyChart.find(entry => entry.name === 'Mastered')?.value ?? 0 },
    ];
    const remaining = Math.max(0, featuredBadge.target - featuredBadge.current);
    const lumiMessage = allEarned
      ? _(lumiDoneCopy)
      : <Trans {...lumiNextCopy} values={{ remaining: _({ ...remainingCopy[featuredBadge.unitKind], values: { count: remaining } }), badge: featuredBadge.title }} components={{ 0: <span className="ach-lumi-badge" /> }} />;
    return <section className="achievements-board achievements-board--crystal" aria-labelledby="achievements-heading">
      <span className="sr-only" aria-live="polite">{celebrationMessage}</span>
      <div className="ach-crystal" data-achievements-board>
        <div className="ach-main-head">{heading}{backButton}</div>
        <aside className="ach-side">
          <div className="ach-emblem-card crystal-chamfer">
            <div className="ach-emblem-row">
              <span className="ach-emblem" aria-hidden="true"><span className="ach-emblem-face">{formatNumber(unlockedIds.size)}</span></span>
              <div className="min-w-0"><p className="ach-emblem-name">{_(text.badges)}</p>{kicker}</div>
            </div>
            {levelFacts && <p className="ach-emblem-level tabular-nums" data-learner-level={levelFacts.level}>{_({ ...crystalLevelLine, values: { level: formatNumber(levelFacts.level), xp: formatNumber(levelFacts.xp), next: formatNumber(levelFacts.next) } })}</p>}
            <span className="ach-emblem-bar" aria-hidden="true"><span style={{ width: `${levelFacts ? levelFacts.percent : unlockedPercent}%` }} /></span>
          </div>
          <div className="ach-bloom-card crystal-chamfer" data-achievement-summary>
            <p className="ach-side-title">{_(text.cardsByBloom)}</p>
            <ul className="ach-bloom-list">{bloomRows.map(row => <li key={row.kind} data-kind={row.kind}>
              <span className="ach-grade" aria-hidden="true">{row.grade}</span>
              <div className="min-w-0 flex-1"><div className="ach-bloom-row"><span>{row.label}</span><span className="tabular-nums">{formatNumber(row.count)}</span></div><span className="ach-bloom-track" aria-hidden="true"><span style={{ width: `${stats.total > 0 ? Math.round(row.count / stats.total * 100) : 0}%` }} /></span></div>
            </li>)}</ul>
          </div>
          {readLumiEnabled() && <div className="ach-lumi-card crystal-chamfer">
            <Lumi pose="proud" className="ach-lumi-figure motion-reduce:animate-none" />
            <p className="ach-lumi-copy"><span className="ach-lumi-name">{_(text.lumiLink)}</span><span className="ach-lumi-message">{lumiMessage}</span></p>
          </div>}
        </aside>
        <div className="ach-main-body">
          <div className="ach-feature-wrap">
            <CrystalPathWings className="ach-feature-wings" />
            <div className="ach-feature-rim">
              <article data-featured-achievement data-badge-id={featuredBadge.id} data-tier={featuredBadge.tierKey} className="ach-feature">
                <span className="ach-feature-tier">{featuredBadge.tier}</span>
                <CrystalStar className="ach-feature-star motion-reduce:animate-none" />
                <h2 className="ach-feature-title">{featuredBadge.title}</h2>
                <p className="ach-feature-desc">{featuredBadge.description}</p>
                <div className="ach-feature-progress">
                  <div className="ach-feature-row"><span>{_(text.progress)}</span><span className="tabular-nums">{formatNumber(shownCurrent(featuredBadge))} / {formatNumber(featuredBadge.target)} {featuredBadge.unit}</span></div>
                  <span className="ach-feature-track" aria-hidden="true"><span style={{ width: `${featuredBadge.progress}%` }} /></span>
                </div>
              </article>
            </div>
          </div>
          <div className="min-w-0"><h2 className="sr-only">{_(text.badges)}</h2>{grid}</div>
        </div>
      </div>
    </section>;
  }

  const ringFraction = levelFacts ? levelFacts.percent / 100 : unlockedIds.size / badges.length;
  return <section className="achievements-board achievements-board--classic" aria-labelledby="achievements-heading">
    <span className="sr-only" aria-live="polite">{celebrationMessage}</span>
    {backButton}
    <header className="ach-hero">
      <div className="ach-ring" aria-hidden="true">
        <svg viewBox="0 0 150 150" className="ach-ring-svg" focusable="false">
          <circle className="ach-ring-track" cx="75" cy="75" r="66" />
          {ringFraction > 0 && <circle className="ach-ring-value" cx="75" cy="75" r="66" strokeDasharray={`${(RING_CIRCUMFERENCE * ringFraction).toFixed(1)} ${RING_CIRCUMFERENCE.toFixed(1)}`} />}
        </svg>
        <span className="ach-ring-core"><span className="ach-ring-label">{levelFacts ? _(levelLabel) : _(text.unlocked)}</span><span className="ach-ring-number">{formatNumber(levelFacts ? levelFacts.level : unlockedIds.size)}</span></span>
      </div>
      <div className="ach-hero-main">
        {kicker}
        {heading}
        {levelFacts
          ? <div className="ach-meter" data-learner-level={levelFacts.level}>
            <div className="ach-meter-row">
              <span><Trans {...levelMeter} values={{ xp: formatNumber(levelFacts.xp), next: formatNumber(levelFacts.next), level: formatNumber(levelFacts.level + 1) }} components={{ 0: <span className="ach-mono" /> }} /></span>
              {/* The board estimates the sessions left; without enough recent study days the share of the level stands in. */}
              <span className="tabular-nums">{sessionsLeft !== null ? _({ ...levelSessions, values: { count: sessionsLeft } }) : `${formatNumber(levelFacts.percent)}%`}</span>
            </div>
            <span className="ach-meter-track" aria-hidden="true"><span className="ach-meter-fill" style={{ width: `${levelFacts.percent}%` }} /></span>
          </div>
          : <div className="ach-meter" data-featured-achievement data-badge-id={featuredBadge.id}>
            <div className="ach-meter-row">
              <span>{allEarned ? _(text.allEarned) : <Trans {...nextBadgeMeter} values={{ current: formatNumber(featuredBadge.current), target: formatNumber(featuredBadge.target), unit: featuredBadge.unit, badge: featuredBadge.title }} components={{ 0: <span className="ach-mono" /> }} />}</span>
              <span className="tabular-nums">{formatNumber(allEarned ? 100 : featuredBadge.progress)}%</span>
            </div>
            <span className="ach-meter-track" aria-hidden="true"><span className="ach-meter-fill" style={{ width: `${allEarned ? 100 : featuredBadge.progress}%` }} /></span>
          </div>}
      </div>
      <dl className="ach-tiles" data-achievement-summary>
        {[[_(text.studyXp), studyXp], [_(text.reviewed), stats.reviewed], [_(text.mastered), stats.learned]].map(([label, value]) => <div key={label as string} className="ach-tile"><dt>{label}</dt><dd className="tabular-nums">{formatNumber(value as number)}</dd></div>)}
      </dl>
    </header>
    <div className="ach-badges-head">
      <h2 className="ach-badges-title">{_(text.badges)}</h2>
      <ul className="ach-legend" aria-label={_(text.legendLabel)}>
        <li><span aria-hidden="true" className="ach-legend-dot ach-legend-dot--earned" />{_(text.earned)}</li>
        <li><span aria-hidden="true" className="ach-legend-dot ach-legend-dot--star" />{_(text.starTier)}</li>
        <li><span aria-hidden="true" className="ach-legend-dot ach-legend-dot--progress" />{_(text.inProgress)}</li>
      </ul>
    </div>
    <div data-achievements-board>{grid}</div>
  </section>;
}
