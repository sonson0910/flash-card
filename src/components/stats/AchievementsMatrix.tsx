import { ArrowLeft, Award, Check, Crown, Flame, Lock, Moon, Sparkles, Target, Trophy } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import type { MessageDescriptor } from '@lingui/core';
import { formatNumber } from '../../lib/format';
import { Lumi } from '../lumi/Lumi';
import { CrystalStar } from './CrystalStar';
import { CrystalPathWings } from '../../features/catalogWorkspace/CrystalPathWings';
import { useTheme } from '../../features/theme/ThemeProvider';
import { readLumiEnabled } from '../../features/settings/lumi-preference';
import type { LibraryStatsViewModel } from '../../features/library/libraryViewModel';
import { sessionsToNextLevel } from '../../features/dailyLearning/todayScreenFacts';
import type { AchievementRecord } from '../../../functions/src/achievement-rules';
import { AccountAvatar } from '../account/AccountAvatar';
import type { SyncIdentityViewModel } from '../shell/shellTypes';
import { useAchievementsLearner } from './AchievementsMatrixLearner';
import {
  buildAchievementsBoard,
  formatEarnedDay,
  formatEarnedDayLong,
  lateReviewWindow,
  recordedBadgeCopy,
  titleCopy,
  type AchievementBadgeId,
  type AchievementBadgeTierKey,
  type AchievementsBoardModel,
  type BoardBadge,
  type BoardBadgeUnit,
  type BoardTitle,
} from './achievementsBoard';
import { classicBadgeGlyphs, crystalBadgeGlyphs, glyphFromIcon, type BadgeGlyph } from './achievementGlyphs';
import './stats-board.css';
import './achievements-board.css';

export { computeAchievementBadgeStats, resolveAchievementBadgeState } from './achievementsBoard';
export type { AchievementBadgeId, AchievementBadgeStat, AchievementBadgeTierKey, AchievementBadgeVisualState } from './achievementsBoard';

interface AchievementsMatrixProps {
  stats: LibraryStatsViewModel;
  readonly onBackToProgress?: () => void;
  /** The moment the streak, study pace and date years are worked out for; the current time by default. */
  readonly now?: Date;
}

const text = {
  bud: msg({ id: 'stats.tier-bud', message: 'Bud' }), bloom: msg({ id: 'stats.tier-bloom', message: 'Bloom' }), star: msg({ id: 'stats.tier-star', message: 'Star' }),
  unlocked: msg({ id: 'stats.unlocked', message: 'unlocked' }), progress: msg({ id: 'stats.progress', message: 'Progress' }),
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
  gentleNightStudy: msg({ id: 'stats.bud-night-study', message: 'Steady return' }), gentleNightStudyDescription: msg({ id: 'stats.bud-night-study-description', message: 'Return for five active study days.' }),
  studyMilestones: msg({ id: 'stats.study-milestones', message: 'Study milestones' }), achievements: msg({ id: 'stats.achievements', message: 'Achievements' }), backToProgress: msg({ id: 'stats.back-to-progress', message: 'Back to Progress' }),
  allEarned: msg({ id: 'stats.all-badges-earned', message: 'Every badge is unlocked' }),
  collection: msg({ id: 'achievements.collection', message: 'Collection' }), titles: msg({ id: 'achievements.titles', message: 'Titles' }),
  cards: msg({ id: 'achievements.cards', message: 'Cards' }),
  totalXp: msg({ id: 'achievements.tile.total-xp', message: 'Total XP' }), bestStreak: msg({ id: 'achievements.tile.best-streak', message: 'Best streak' }), studyPace: msg({ id: 'achievements.tile.study-pace', message: 'Study pace' }),
  shownOnCard: msg({ id: 'achievements.title.shown', message: 'Shown on your card' }),
};

const wordGardenTitle = msg({ id: 'stats.word-garden-title', message: 'Your word <0>garden</0>' });
const cardsTotalCopy = msg({ id: 'achievements.cards.total', message: '{count, plural, one {# card in total} other {# cards in total}}' });
const cardsShareCopy = msg({ id: 'achievements.cards.share', message: '{percent}% of your cards' });
const titleHeading = msg({ id: 'achievements.heading.title', message: '{title}, <0>still climbing.</0>' });
const nextBadgeMeter = msg({ id: 'stats.next-badge-meter', message: '<0>{current}</0> / {target} {unit} toward {badge}' });
const meterUnits: Record<'days' | 'words', MessageDescriptor> = {
  days: msg({ id: 'stats.days', message: 'days' }),
  words: msg({ id: 'stats.words', message: 'words' }),
};
const remainingCopy: Record<BoardBadgeUnit, MessageDescriptor> = {
  days: msg({ id: 'stats.remaining-days', message: '{count, plural, one {# day} other {# days}}' }),
  words: msg({ id: 'stats.remaining-words', message: '{count, plural, one {# word} other {# words}}' }),
  xp: msg({ id: 'stats.remaining-xp', message: '{count} XP' }),
  cards: msg({ id: 'achievements.remaining-cards', message: '{count, plural, one {# card} other {# cards}}' }),
  reviews: msg({ id: 'achievements.remaining-reviews', message: '{count, plural, one {# review} other {# reviews}}' }),
  answers: msg({ id: 'achievements.remaining-answers', message: '{count, plural, one {# correct answer} other {# correct answers}}' }),
};
const earnedCount = msg({ id: 'stats.earned-count', message: '{earned} of {total} earned' });
const unlockedCount = msg({ id: 'achievements.unlocked-count', message: '{earned} / {total} unlocked' });
const levelLabel = msg({ id: 'stats.level', message: 'Level' });
const levelMeter = msg({ id: 'stats.level-meter', message: '<0>{xp}</0> / {next} XP to Level {level}' });
const levelSessions = msg({ id: 'stats.level-sessions', message: '≈ {count, plural, one {# session} other {# sessions}}' });
const emblemLevelLine = msg({ id: 'stats.level-line', message: 'Lv {level} · {xp} / {next} XP' });
const profileLevelLine =msg({ id: 'achievements.profile.level', message: 'Lv {level} <0>· {xp} / {next} XP</0>' });
const lumiNextCopy = msg({ id: 'stats.lumi-next', message: '{remaining} to go for <0>{badge}</0>.' });
const lumiDoneCopy = msg({ id: 'stats.lumi-done', message: 'Every badge is in bloom. Wonderful work!' });
const earnedOnCopy = msg({ id: 'achievements.earned-on', message: 'Earned {date}' });
const earnedByCopy = msg({ id: 'achievements.earned-by', message: 'Earned by {date}' });
const earnedByLongCopy = msg({ id: 'achievements.earned-by.long', message: 'Earned on or before {date}. The exact day was not recorded.' });
const bestStreakValue = msg({ id: 'achievements.tile.best-streak.value', message: '{count} d' });
const paceValue = msg({ id: 'achievements.tile.study-pace.value', message: '{minutes}<0> min a day</0>' });
const reachLevelCopy = msg({ id: 'achievements.title.reach-level', message: 'Reach level {level}' });
const titleLevelProgress = msg({ id: 'achievements.title.level-progress', message: 'Lv {current} / {target}' });

export function findNewlyUnlockedBadgeIds(previous: ReadonlySet<string>, current: ReadonlySet<string>): string[] {
  return [...current].filter(id => !previous.has(id));
}

/** Localized copy for each badge the board works out from library statistics, keyed by the id `computeAchievementBadgeStats` returns. */
export const achievementBadgeCopy: Record<AchievementBadgeId, {
  title: MessageDescriptor; description: MessageDescriptor; tier: MessageDescriptor; tierKey: AchievementBadgeTierKey; icon: typeof Trophy;
}> = {
  streak_3: { title: text.budRoutine, description: text.budRoutineDescription, tier: text.bud, tierKey: 'bud', icon: Flame },
  mastery_10: { title: text.bloomingRecall, description: text.bloomingRecallDescription, tier: text.bloom, tierKey: 'bloom', icon: Sparkles },
  mastery_50: { title: text.starKeeper, description: text.starKeeperDescription, tier: text.star, tierKey: 'star', icon: Trophy },
  xp_100: { title: text.brightStudyDay, description: text.brightStudyDayDescription, tier: text.bloom, tierKey: 'bloom', icon: Target },
  xp_total_500: { title: text.growingCollection, description: text.growingCollectionDescription, tier: text.star, tierKey: 'star', icon: Award },
  night_owl: { title: text.gentleNightStudy, description: text.gentleNightStudyDescription, tier: text.bud, tierKey: 'bud', icon: Moon },
};

const legacyGlyphs = Object.fromEntries(Object.entries(achievementBadgeCopy).map(([id, copy]) => [id, glyphFromIcon(copy.icon)])) as Record<AchievementBadgeId, BadgeGlyph>;
const tierLabels: Record<AchievementBadgeTierKey, MessageDescriptor> = { bud: text.bud, bloom: text.bloom, star: text.star };
const titleGlyph = glyphFromIcon(Crown);
/** The profile card of an account without a name or photo: the avatar falls back to a person icon. */
const anonymousIdentity: SyncIdentityViewModel = { status: 'authenticated', displayName: null, email: null, photoUrl: null };

/** A badge with its copy resolved for the current locale and theme family. */
interface ShownBadge {
  readonly badge: BoardBadge;
  readonly name: string;
  readonly condition: string;
  readonly tierLabel: string;
  readonly Glyph: BadgeGlyph;
  /** What the legacy badge's numbers count; recorded badges say it in their condition. */
  readonly unitLabel: string | null;
}

/** The progress shown next to the target, such as "3 / 5". */
const ratio = (shown: ShownBadge, separator: string) => `${formatNumber(shown.badge.value)}${separator}${formatNumber(shown.badge.target)}`;

/** Ring circumference for the 66px radius of the summary ring. */
const RING_CIRCUMFERENCE = 2 * Math.PI * 66;

function Medal({ shown, index }: { readonly shown: ShownBadge; readonly index: number }) {
  const { Glyph, badge } = shown;
  const tilt = badge.state === 'earned' ? (index % 3 - 1) * 4 : 0;
  return <span className="ach-medal" aria-hidden="true" style={{ '--ach-tilt': `${tilt}deg` } as CSSProperties}><Glyph /></span>;
}

/** "Earned 02 Jun", "Earned by 27 Nov" with its full meaning for screen readers, or "Earned" before days were recorded. */
function EarnedDate({ record, now, className, withIcon = false, inline = false }: { readonly record: AchievementRecord | null; readonly now: Date; readonly className?: string; readonly withIcon?: boolean; readonly inline?: boolean }) {
  const { _ } = useLingui();
  const Line = inline ? 'span' : 'p';
  if (!record) return <Line className={className}>{withIcon && <Check size={12} strokeWidth={2.4} aria-hidden="true" />}{_(text.earned)}</Line>;
  const date = formatEarnedDay(record.on, now);
  if (record.exact) return <Line className={className} data-earned-on={record.on}>{_({ ...earnedOnCopy, values: { date } })}</Line>;
  return <Line className={className} data-earned-on={record.on} data-earned-by="">
    <span aria-hidden="true">{_({ ...earnedByCopy, values: { date } })}</span>
    <span className="sr-only">{_({ ...earnedByLongCopy, values: { date: formatEarnedDayLong(record.on) } })}</span>
  </Line>;
}

function BadgeFoot({ shown, isCrystal, now }: { readonly shown: ShownBadge; readonly isCrystal: boolean; readonly now: Date }) {
  const { _ } = useLingui();
  const { badge } = shown;
  if (isCrystal) {
    return <div className="ach-badge-meter">
      <span className="ach-track" aria-hidden="true"><span className="ach-fill" style={{ width: `${badge.percent}%` }} /></span>
      <span className="ach-badge-ratio tabular-nums">{ratio(shown, '/')}{shown.unitLabel && <span className="sr-only"> {shown.unitLabel}</span>}</span>
      {badge.state === 'earned' && <span className="sr-only"><EarnedDate record={badge.earned} now={now} inline /></span>}
      {badge.state === 'locked' && <span className="sr-only">{_(text.locked)}</span>}
    </div>;
  }
  if (badge.state === 'earned') return <EarnedDate record={badge.earned} now={now} className="ach-badge-earned" withIcon={!badge.earned} />;
  if (badge.state === 'locked') return <p className="ach-badge-locked"><Lock size={11} strokeWidth={2.2} aria-hidden="true" />{_(text.locked)}</p>;
  return <>
    <div className="ach-badge-count"><span className="tabular-nums">{ratio(shown, ' / ')}{shown.unitLabel && ` ${shown.unitLabel}`}</span><span className="tabular-nums">{formatNumber(badge.percent)}%</span></div>
    <span className="ach-track" aria-hidden="true"><span className="ach-fill transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${badge.percent}%` }} /></span>
  </>;
}

function BadgeCard({ shown, index, isCrystal, isNewlyUnlocked, now }: { readonly shown: ShownBadge; readonly index: number; readonly isCrystal: boolean; readonly isNewlyUnlocked: boolean; readonly now: Date }) {
  const { _ } = useLingui();
  const { badge } = shown;
  return <article data-badge-id={badge.id} data-newly-unlocked={isNewlyUnlocked || undefined} data-badge-state={badge.state} data-badge-tier={badge.tier} className={`ach-badge ${isNewlyUnlocked ? 'achievement-newly-unlocked' : ''}`}>
    <div className="ach-badge-head">
      <Medal shown={shown} index={index} />
      <div className="ach-badge-name"><h3 className="ach-badge-title">{shown.name}</h3><span className="ach-badge-tier">{shown.tierLabel}</span></div>
    </div>
    <p className="ach-badge-desc">{shown.condition}</p>
    <div className="ach-badge-foot"><BadgeFoot shown={shown} isCrystal={isCrystal} now={now} /></div>
    {!isCrystal && badge.state === 'earned' && badge.tier === 'star' && <span className="ach-badge-sheen" aria-hidden="true" />}
    {isCrystal && badge.state === 'locked' && <span className="ach-badge-veil" aria-hidden="true">
      <svg viewBox="0 0 200 120" preserveAspectRatio="none" focusable="false"><polyline className="ach-veil-line" points="0,64 30,52 52,72 84,44 106,66 132,40 158,62 200,48" /><polyline className="ach-veil-spark" points="84,44 90,18 110,4" /></svg>
      <span className="ach-badge-veil-chip">{_(text.locked)}</span>
    </span>}
  </article>;
}

type CollectionTab = 'badges' | 'cards' | 'titles';

/** The Crystal collection's tabs, in the board's order; arrow keys, Home and End move between them. */
function CollectionTabs({ tabs: collectionTabs, selected, onSelect }: { readonly tabs: readonly CollectionTab[]; readonly selected: CollectionTab; readonly onSelect: (tab: CollectionTab) => void }) {
  const { _ } = useLingui();
  const labels: Record<CollectionTab, string> = { badges: _(text.badges), cards: _(text.cards), titles: _(text.titles) };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = collectionTabs.indexOf(selected);
    const next = event.key === 'ArrowRight' ? (index + 1) % collectionTabs.length
      : event.key === 'ArrowLeft' ? (index - 1 + collectionTabs.length) % collectionTabs.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? collectionTabs.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    onSelect(collectionTabs[next]);
    event.currentTarget.querySelector<HTMLButtonElement>(`#ach-tab-${collectionTabs[next]}`)?.focus();
  };
  return <div role="tablist" aria-label={_(text.collection)} className="ach-tabs" onKeyDown={onKeyDown}>
    {collectionTabs.map(tab => <button key={tab} type="button" role="tab" id={`ach-tab-${tab}`} aria-controls={`ach-panel-${tab}`} aria-selected={selected === tab} tabIndex={selected === tab ? 0 : -1} onClick={() => onSelect(tab)} className="ach-tab cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)]">
      <span className="ach-tab-face"><span className="ach-tab-label">{labels[tab]}</span></span>
    </button>)}
  </div>;
}

/** The learner's card: the account avatar, name, the title shown and the level. */
function ProfileCard({ identity, model }: { readonly identity: SyncIdentityViewModel | undefined; readonly model: AchievementsBoardModel }) {
  const { _ } = useLingui();
  const name = identity?.status === 'authenticated' ? identity.displayName?.trim() ?? '' : '';
  const level = model.level!;
  return <div className="ach-emblem-card ach-profile-card crystal-chamfer" data-achievement-profile>
    <div className="ach-emblem-row">
      <span className="ach-profile-avatar" aria-hidden="true"><span className="ach-profile-avatar-face"><AccountAvatar identity={identity ?? anonymousIdentity} imageClassName="ach-profile-photo" /></span></span>
      <div className="min-w-0">
        {name && <p className="ach-emblem-name ach-profile-name">{name}</p>}
        {model.shownTitleId && <p className="ach-title-chip" data-shown-title={model.shownTitleId}><span>{_(titleCopy[model.shownTitleId])}</span></p>}
        <p className="ach-profile-level tabular-nums" data-learner-level={level.level}>
          <Trans {...profileLevelLine} values={{ level: formatNumber(level.level), xp: formatNumber(level.xpIntoLevel), next: formatNumber(level.levelSpan) }} components={{ 0: <span className="ach-profile-xp" /> }} />
        </p>
      </div>
    </div>
    <span className="ach-emblem-bar" aria-hidden="true"><span style={{ width: `${Math.round(level.progress * 100)}%` }} /></span>
  </div>;
}

/** Both titles: the day each was earned, or the level that earns it. */
function TitlesList({ titles, level, now }: { readonly titles: readonly BoardTitle[]; readonly level: number; readonly now: Date }) {
  const { _ } = useLingui();
  const Glyph = titleGlyph;
  return <ul className="ach-titles-grid">
    {titles.map(title => <li key={title.id} data-title-id={title.id} data-title-state={title.held ? 'earned' : 'locked'} data-title-shown={title.shown || undefined} data-badge-tier="star" className="ach-badge ach-title-card">
      <div className="ach-badge-head">
        <span className="ach-medal" aria-hidden="true"><Glyph /></span>
        <div className="ach-badge-name"><h3 className="ach-badge-title">{_(titleCopy[title.id])}</h3><span className="ach-badge-tier">{_({ ...reachLevelCopy, values: { level: formatNumber(title.level) } })}</span></div>
      </div>
      {title.held
        ? <EarnedDate record={title.earned} now={now} className="ach-title-date" />
        : <div className="ach-badge-meter">
          <span className="ach-track" aria-hidden="true"><span className="ach-fill" style={{ width: `${Math.min(100, Math.round(level / title.level * 100))}%` }} /></span>
          <span className="ach-badge-ratio tabular-nums">{_({ ...titleLevelProgress, values: { current: formatNumber(level), target: formatNumber(title.level) } })}</span>
        </div>}
      {title.shown && <p className="ach-title-shown">{_(text.shownOnCard)}</p>}
    </li>)}
  </ul>;
}

export function AchievementsMatrix({ stats, onBackToProgress, now: nowProp }: AchievementsMatrixProps) {
  const { _ } = useLingui();
  const { family } = useTheme();
  const isCrystal = family === 'crystal';
  const learner = useAchievementsLearner();
  const now = nowProp ?? new Date();
  const model = buildAchievementsBoard(stats, learner, now);
  const lateWindow = model.recorded ? lateReviewWindow() : null;
  const legacyUnit = (unit: BoardBadgeUnit) => unit === 'days' || unit === 'words' ? _(meterUnits[unit]) : 'XP';
  const shownBadges: ShownBadge[] = model.badges.map(badge => {
    if (!model.recorded) {
      const copy = achievementBadgeCopy[badge.id as AchievementBadgeId];
      return { badge, name: _(copy.title), condition: _(copy.description), tierLabel: _(copy.tier), Glyph: legacyGlyphs[badge.id as AchievementBadgeId], unitLabel: legacyUnit(badge.unit) };
    }
    const copy = recordedBadgeCopy[badge.id];
    return {
      badge,
      name: _(copy.name),
      condition: _({ ...copy.condition, values: { target: formatNumber(badge.target), ...lateWindow } }),
      tierLabel: _(tierLabels[badge.tier]),
      Glyph: (isCrystal ? crystalBadgeGlyphs : classicBadgeGlyphs)[badge.id],
      unitLabel: null,
    };
  });
  const featured = shownBadges.find(shown => shown.badge === model.featured) ?? shownBadges[0];
  const allEarned = model.earnedCount === model.badges.length;
  const [tab, setTab] = useState<CollectionTab>('badges');

  const unlockedSignature = model.badges.filter(badge => badge.state === 'earned').map(badge => badge.id).join('|');
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
  const celebrationMessage = shownBadges.filter(shown => celebratingIds.has(shown.badge.id)).map(shown => `${shown.name} ${_(text.unlocked)}`).join('. ');

  const level = model.level;
  const shownTitle = model.shownTitleId ? _(titleCopy[model.shownTitleId]) : null;
  const sessionsLeft = level ? sessionsToNextLevel(level.levelSpan - level.xpIntoLevel, stats.xpChartData) : null;
  const totals = { earned: formatNumber(model.earnedCount), total: formatNumber(model.badges.length) };
  const kicker = <p className="ach-kicker">{onBackToProgress ? _(text.achievements) : _(text.studyMilestones)} · {_({ ...earnedCount, values: totals })}</p>;
  const backButton = onBackToProgress && <button type="button" onClick={onBackToProgress} className="ach-back crystal-chamfer-sm inline-flex min-h-11 cursor-pointer items-center gap-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)] motion-reduce:transition-none"><ArrowLeft size={16} aria-hidden="true" />{_(text.backToProgress)}</button>;
  const grid = <div data-achievement-grid className="ach-grid">{shownBadges.map((shown, index) => <BadgeCard key={shown.badge.id} shown={shown} index={index} isCrystal={isCrystal} isNewlyUnlocked={celebratingIds.has(shown.badge.id)} now={now} />)}</div>;

  if (isCrystal) {
    // The profile card draws the verified state; with only the level, the emblem card keeps the badge count.
    const signedIn = Boolean(level && learner?.gamification);
    const heading = <h1 id="achievements-heading" className="ach-title text-balance">{signedIn ? _(text.collection) : <Trans {...wordGardenTitle} components={{ 0: <em className="ach-title-accent" /> }} />}</h1>;
    // Titles exist only for a learner with a verified level; badges and cards always have a tab.
    const tabs: readonly CollectionTab[] = model.titles.length > 0 ? ['badges', 'cards', 'titles'] : ['badges', 'cards'];
    const selectedTab = tabs.includes(tab) ? tab : 'badges';
    const bloomRows = [
      { kind: 'new', grade: _(text.gradeNew), label: _(text.notReviewed), count: stats.difficultyChart.find(entry => entry.name === 'Not reviewed')?.value ?? 0 },
      { kind: 'learning', grade: _(text.gradeLearning), label: _(text.learning), count: stats.difficultyChart.find(entry => entry.name === 'Learning')?.value ?? 0 },
      { kind: 'mastered', grade: _(text.gradeMastered), label: _(text.mastered), count: stats.difficultyChart.find(entry => entry.name === 'Mastered')?.value ?? 0 },
    ];
    const bloomShare = (count: number) => stats.total > 0 ? Math.round(count / stats.total * 100) : 0;
    // The same tier counts the side card draws, with each tier's share; no read of its own.
    const bloomList = (withShare: boolean) => <ul className="ach-bloom-list">{bloomRows.map(row => <li key={row.kind} data-kind={row.kind}>
      <span className="ach-grade" aria-hidden="true">{row.grade}</span>
      <div className="min-w-0 flex-1">
        <div className="ach-bloom-row"><span>{row.label}</span><span className="tabular-nums">{formatNumber(row.count)}</span></div>
        <span className="ach-bloom-track" aria-hidden="true"><span style={{ width: `${bloomShare(row.count)}%` }} /></span>
        {withShare && <span className="ach-bloom-share tabular-nums">{_({ ...cardsShareCopy, values: { percent: formatNumber(bloomShare(row.count)) } })}</span>}
      </div>
    </li>)}</ul>;
    const remaining = Math.max(0, featured.badge.target - featured.badge.value);
    const lumiMessage = allEarned
      ? _(lumiDoneCopy)
      : <Trans {...lumiNextCopy} values={{ remaining: _({ ...remainingCopy[featured.badge.unit], values: { count: remaining } }), badge: featured.name }} components={{ 0: <span className="ach-lumi-badge" /> }} />;
    const badgesBody = <>
      <div className="ach-feature-wrap">
        <CrystalPathWings className="ach-feature-wings" />
        <div className="ach-feature-rim">
          <article data-featured-achievement data-badge-id={featured.badge.id} data-tier={featured.badge.tier} className="ach-feature">
            <span className="ach-feature-tier">{featured.tierLabel}</span>
            <CrystalStar className="ach-feature-star motion-reduce:animate-none" />
            <h2 className="ach-feature-title">{featured.name}</h2>
            <p className="ach-feature-desc">{featured.condition}</p>
            <div className="ach-feature-progress">
              <div className="ach-feature-row"><span>{_(text.progress)}</span><span className="tabular-nums">{ratio(featured, ' / ')}{featured.unitLabel && ` ${featured.unitLabel}`}</span></div>
              <span className="ach-feature-track" aria-hidden="true"><span style={{ width: `${featured.badge.percent}%` }} /></span>
            </div>
          </article>
        </div>
      </div>
      <div className="min-w-0"><h2 className="sr-only">{_(text.badges)}</h2>{grid}</div>
    </>;
    return <section className="achievements-board achievements-board--crystal" aria-labelledby="achievements-heading">
      <span className="sr-only" aria-live="polite">{celebrationMessage}</span>
      <div className="ach-crystal" data-achievements-board>
        <div className="ach-main-head">
          {heading}
          <CollectionTabs tabs={tabs} selected={selectedTab} onSelect={setTab} />
          {signedIn && <p className="ach-unlocked-count tabular-nums">{_({ ...unlockedCount, values: totals })}</p>}
          {backButton}
        </div>
        <aside className="ach-side">
          {signedIn
            ? <ProfileCard identity={learner?.identity} model={model} />
            : <div className="ach-emblem-card crystal-chamfer">
              <div className="ach-emblem-row">
                <span className="ach-emblem" aria-hidden="true"><span className="ach-emblem-face">{formatNumber(model.earnedCount)}</span></span>
                <div className="min-w-0"><p className="ach-emblem-name">{_(text.badges)}</p>{kicker}</div>
              </div>
              {level && <p className="ach-emblem-level tabular-nums" data-learner-level={level.level}>{_({ ...emblemLevelLine, values: { level: formatNumber(level.level), xp: formatNumber(level.xpIntoLevel), next: formatNumber(level.levelSpan) } })}</p>}
              <span className="ach-emblem-bar" aria-hidden="true"><span style={{ width: `${level ? Math.round(level.progress * 100) : Math.round(model.earnedCount / model.badges.length * 100)}%` }} /></span>
            </div>}
          {selectedTab !== 'cards' && <div className="ach-bloom-card crystal-chamfer" data-achievement-summary>
            <p className="ach-side-title">{_(text.cardsByBloom)}</p>
            {bloomList(false)}
          </div>}
          {readLumiEnabled() && <div className="ach-lumi-card crystal-chamfer">
            <Lumi pose="proud" className="ach-lumi-figure motion-reduce:animate-none" />
            <p className="ach-lumi-copy"><span className="ach-lumi-name">{_(text.lumiLink)}</span><span className="ach-lumi-message">{lumiMessage}</span></p>
          </div>}
        </aside>
        <div role="tabpanel" id="ach-panel-badges" aria-labelledby="ach-tab-badges" hidden={selectedTab !== 'badges'} className="ach-main-body">{badgesBody}</div>
        <div role="tabpanel" id="ach-panel-cards" aria-labelledby="ach-tab-cards" hidden={selectedTab !== 'cards'} className="ach-main-body ach-main-body--cards">
          <section className="ach-bloom-card ach-bloom-card--wide crystal-chamfer" aria-labelledby="ach-cards-heading" data-achievement-cards>
            <h2 id="ach-cards-heading" className="ach-side-title">{_(text.cardsByBloom)}</h2>
            <p className="ach-cards-total tabular-nums">{_({ ...cardsTotalCopy, values: { count: stats.total } })}</p>
            {bloomList(true)}
          </section>
        </div>
        {model.titles.length > 0 && <div role="tabpanel" id="ach-panel-titles" aria-labelledby="ach-tab-titles" hidden={selectedTab !== 'titles'} className="ach-main-body ach-main-body--titles">
          <TitlesList titles={model.titles} level={level?.level ?? 1} now={now} />
        </div>}
      </div>
    </section>;
  }

  const heading = <h1 id="achievements-heading" className="ach-title text-balance">{shownTitle
    ? <Trans {...titleHeading} values={{ title: shownTitle }} components={{ 0: <em className="ach-title-accent" /> }} />
    : <Trans {...wordGardenTitle} components={{ 0: <em className="ach-title-accent" /> }} />}</h1>;
  const tiles: Array<{ key: string; label: string; value: ReactNode }> =model.totalXp !== null
    ? [
      { key: 'xp', label: _(text.totalXp), value: formatNumber(model.totalXp) },
      ...(model.bestStreak !== null ? [{ key: 'best', label: _(text.bestStreak), value: _({ ...bestStreakValue, values: { count: formatNumber(model.bestStreak) } }) }] : []),
      ...(model.paceMinutes !== null ? [{ key: 'pace', label: _(text.studyPace), value: <Trans {...paceValue} values={{ minutes: formatNumber(model.paceMinutes) }} components={{ 0: <span className="ach-tile-unit" /> }} /> }] : []),
    ]
    : [
      { key: 'xp', label: _(text.studyXp), value: formatNumber(stats.xpChartData.reduce((sum, item) => sum + item.XP, 0)) },
      { key: 'reviewed', label: _(text.reviewed), value: formatNumber(stats.reviewed) },
      { key: 'mastered', label: _(text.mastered), value: formatNumber(stats.learned) },
    ];
  const ringFraction = level ? level.progress : model.earnedCount / model.badges.length;
  const levelPercent = level ? Math.round(level.progress * 100) : 0;
  return <section className="achievements-board achievements-board--classic" aria-labelledby="achievements-heading">
    <span className="sr-only" aria-live="polite">{celebrationMessage}</span>
    {backButton}
    <header className="ach-hero">
      <div className="ach-ring" aria-hidden="true">
        <svg viewBox="0 0 150 150" className="ach-ring-svg" focusable="false">
          <circle className="ach-ring-track" cx="75" cy="75" r="66" />
          {ringFraction > 0 && <circle className="ach-ring-value" cx="75" cy="75" r="66" strokeDasharray={`${(RING_CIRCUMFERENCE * ringFraction).toFixed(1)} ${RING_CIRCUMFERENCE.toFixed(1)}`} />}
        </svg>
        <span className="ach-ring-core"><span className="ach-ring-label">{level ? _(levelLabel) : _(text.unlocked)}</span><span className="ach-ring-number">{formatNumber(level ? level.level : model.earnedCount)}</span></span>
      </div>
      <div className="ach-hero-main">
        {kicker}
        {heading}
        {level
          ? <div className="ach-meter" data-learner-level={level.level}>
            <div className="ach-meter-row">
              <span><Trans {...levelMeter} values={{ xp: formatNumber(level.xpIntoLevel), next: formatNumber(level.levelSpan), level: formatNumber(level.level + 1) }} components={{ 0: <span className="ach-mono" /> }} /></span>
              {/* The board estimates the sessions left; without enough recent study days the share of the level stands in. */}
              <span className="tabular-nums">{sessionsLeft !== null ? _({ ...levelSessions, values: { count: sessionsLeft } }) : `${formatNumber(levelPercent)}%`}</span>
            </div>
            <span className="ach-meter-track" aria-hidden="true"><span className="ach-meter-fill" style={{ width: `${levelPercent}%` }} /></span>
          </div>
          : <div className="ach-meter" data-featured-achievement data-badge-id={featured.badge.id}>
            <div className="ach-meter-row">
              <span>{allEarned ? _(text.allEarned) : <Trans {...nextBadgeMeter} values={{ current: formatNumber(featured.badge.value), target: formatNumber(featured.badge.target), unit: featured.unitLabel ?? legacyUnit(featured.badge.unit), badge: featured.name }} components={{ 0: <span className="ach-mono" /> }} />}</span>
              <span className="tabular-nums">{formatNumber(allEarned ? 100 : featured.badge.percent)}%</span>
            </div>
            <span className="ach-meter-track" aria-hidden="true"><span className="ach-meter-fill" style={{ width: `${allEarned ? 100 : featured.badge.percent}%` }} /></span>
          </div>}
      </div>
      <dl className="ach-tiles" data-achievement-summary>
        {tiles.map(tile => <div key={tile.key} className="ach-tile" data-tile={tile.key}><dt>{tile.label}</dt><dd className="tabular-nums">{tile.value}</dd></div>)}
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
