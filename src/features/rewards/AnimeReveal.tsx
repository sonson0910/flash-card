import * as Dialog from '@radix-ui/react-dialog';
import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { Loader2, X } from 'lucide-react';
import { Fragment, useEffect, useRef, useState } from 'react';
import { Lumi } from '../../components/lumi/Lumi';
import { useReducedMotion } from '../../lib/motionPreferenceHooks';
import { useTheme } from '../theme/ThemeProvider';
import type { WeeklyRecapShareOutcome } from '../weeklyRecap/weeklyRecapShare';
import type { RevealShareCard } from './revealShareImage';
import './anime-reveal.css';

export type AnimeRevealEventKind = 'tierup' | 'streak' | 'levelup';
/** What the review that reached a streak milestone changed, as the server reported it. */
export interface AnimeRevealStreakFacts {
  /** Days in the run that reached the milestone. */
  readonly length: number;
  /** Streak freezes the review added; 0 when it added none. */
  readonly freezesEarned: number;
  /** Streak freezes held after the review, when the source knows. */
  readonly freezesHeld?: number;
  /** Bonus XP the milestone granted, when it granted any. */
  readonly milestoneXp?: number;
}
/** Values are supplied by the committed event source; Canvas values are never fallbacks. */
export interface AnimeRevealSourcePayload {
  readonly title?: string; readonly description?: string; readonly previousValue?: string; readonly currentValue?: string;
  readonly rewardLabels?: readonly string[]; readonly imageUrl?: string; readonly headword?: string;
  readonly translation?: string; readonly lexicalLabel?: string;
  readonly streak?: AnimeRevealStreakFacts;
}
export interface AnimeRevealProps {
  readonly open: boolean; readonly event: AnimeRevealEventKind; readonly payload?: AnimeRevealSourcePayload;
  /** Parent owns closing and advancing: each gesture invokes exactly one semantic callback. */
  readonly onContinue: () => void; readonly onEquip: () => Promise<void>; readonly onLater: () => void;
  readonly lumiEnabled?: boolean; readonly reducedMotion?: boolean;
}
type Values = Record<string, unknown>;
type Translate = (descriptor: MessageDescriptor, values?: Values) => string;
/** One message with its values, so the screen and the shared image read the same copy. */
type Phrase = readonly [MessageDescriptor, Values?];

const copy = {
  tierup: { kicker: msg({ context: 'rewards.reveal.tierup.kicker', message: 'Tier up' }), title: msg({ context: 'rewards.reveal.tierup.title', message: 'Mastered' }), description: msg({ context: 'rewards.reveal.tierup.description', message: 'This card is now mastered. Review it again when it is due.' }), action: msg({ context: 'rewards.reveal.tierup.continue', message: 'Continue learning' }) },
  streak: { kicker: msg({ context: 'rewards.reveal.streak.kicker', message: 'Streak milestone' }), title: msg({ context: 'rewards.reveal.streak.title', message: 'Streak reached' }), description: msg({ context: 'rewards.reveal.streak.description', message: 'Your verified review streak earned the Web Wanderer badge.' }), action: msg({ context: 'rewards.reveal.streak.continue', message: 'Keep going' }) },
  levelup: { kicker: msg({ context: 'rewards.reveal.levelup.kicker', message: 'Level up' }), title: msg({ context: 'rewards.reveal.levelup.title', message: 'Level up' }), description: msg({ context: 'rewards.reveal.levelup.description', message: 'You unlocked the Crimson Wing frame and Word Collector title. You can hold up to three hint tokens.' }), action: msg({ context: 'rewards.reveal.levelup.equip', message: 'Use frame' }) },
} as const;
const tierCopy: Record<string, MessageDescriptor> = {
  new: msg({ context: 'rewards.reveal.tier.new', message: 'New' }),
  learning: msg({ context: 'rewards.reveal.tier.learning', message: 'Learning' }),
  mastered: msg({ context: 'rewards.reveal.tier.mastered', message: 'Mastered' }),
};
/** Crystal Star names the tiers after its card rims. */
const crystalTierCopy: Record<string, MessageDescriptor> = {
  new: msg({ id: 'rewards.reveal.tier-name.new', message: 'Bud' }),
  learning: msg({ id: 'rewards.reveal.tier-name.learning', message: 'Bloom' }),
  mastered: msg({ id: 'rewards.reveal.tier-name.mastered', message: 'Star' }),
};
const tierNames = (crystal: boolean) => (crystal ? crystalTierCopy : tierCopy);
const streakCopy = {
  days: msg({ id: 'rewards.reveal.streak.days', message: '{count}-day streak' }),
  month: msg({ id: 'rewards.reveal.streak.month', message: 'A full month of study.' }),
  run: msg({ id: 'rewards.reveal.streak.run', message: '{count} days of study in a row.' }),
  freezeEarned: msg({ id: 'rewards.reveal.streak.freeze-earned', message: '{count, plural, one {You earned # streak freeze, so one missed day will not break the chain.} other {You earned # streak freezes, so # missed days will not break the chain.}}' }),
  freezeHeld: msg({ id: 'rewards.reveal.streak.freeze-held', message: 'You now hold {count}.' }),
  chipFreeze: msg({ id: 'rewards.reveal.streak.chip.freeze', message: '{count, plural, one {+# streak freeze} other {+# streak freezes}}' }),
  chipXp: msg({ id: 'rewards.reveal.streak.chip.xp', message: '+{xp} XP' }),
  chipBadge: msg({ id: 'rewards.reveal.streak.chip.badge', message: 'Badge · {badge}' }),
};
const shareCopy = {
  tierup: msg({ context: 'rewards.reveal.share-card', message: 'Share card' }),
  streak: msg({ context: 'rewards.reveal.share', message: 'Share' }),
};
const shareOutcomeCopy: Record<WeeklyRecapShareOutcome, MessageDescriptor> = {
  shared: msg({ context: 'rewards.reveal.share-outcome.shared', message: 'Shared.' }),
  copied: msg({ context: 'rewards.reveal.share-outcome.copied', message: 'Copied to your clipboard.' }),
  downloaded: msg({ context: 'rewards.reveal.share-outcome.downloaded', message: 'Downloaded.' }),
  failed: msg({ context: 'rewards.reveal.share-outcome.failed', message: 'Sharing was cancelled.' }),
};
type ShareState = 'busy' | 'error' | WeeklyRecapShareOutcome | null;

function TierLabel({ value, crystal }: { value?: string; crystal: boolean }) {
  const names = tierNames(crystal);
  return value && names[value] ? <Trans {...names[value]} /> : <>{value}</>;
}
function TierArtifact({ payload, crystal }: { payload?: AnimeRevealSourcePayload; crystal: boolean }) {
  return <div className="anime-reveal__tier-art" aria-hidden="true"><div className="anime-reveal__tier-card">
    {payload?.imageUrl ? <img src={payload.imageUrl} alt="" /> : <div className="anime-reveal__tier-image" />}
    <div>{payload?.lexicalLabel ? <small>{payload.lexicalLabel}</small> : null}{payload?.headword ? <strong>{payload.headword}</strong> : null}{payload?.translation ? <span>{payload.translation}</span> : null}
      {payload?.previousValue && payload.currentValue ? <b><span><TierLabel value={payload.previousValue} crystal={crystal} /></span> <i>→</i> <em data-tier={payload.currentValue}><TierLabel value={payload.currentValue} crystal={crystal} /></em></b> : null}</div>
  </div><span className="anime-reveal__flare" /></div>;
}
function StreakArtifact({ value }: { value?: string }) {
  return <div className="anime-reveal__streak-art" aria-hidden="true"><svg viewBox="0 0 24 28"><path d="M12 1c1.3 4.2-1.8 6.6-1.8 9.8 0 1.7 1.2 3 2.8 3 1.8 0 2.9-1.4 2.6-3.6 2.8 2 4.2 5.1 4.2 8.1C19.8 23.4 16.3 27 12 27s-7.8-2.9-7.8-7.3C4.2 14.1 9.4 11.4 12 1z" /></svg>{value ? <strong>{value}</strong> : null}<span>★</span></div>;
}
function streakDescription(facts: AnimeRevealStreakFacts): Phrase[] {
  return [
    facts.length === 30 ? [streakCopy.month] : [streakCopy.run, { count: facts.length }],
    ...(facts.freezesEarned > 0 ? [[streakCopy.freezeEarned, { count: facts.freezesEarned }] as const] : []),
    ...(facts.freezesEarned > 0 && facts.freezesHeld !== undefined ? [[streakCopy.freezeHeld, { count: facts.freezesHeld }] as const] : []),
  ];
}
function StreakDescription({ facts }: { facts: AnimeRevealStreakFacts }) {
  return streakDescription(facts).map(([message, values], index) => <Fragment key={message.id}>{index > 0 ? ' ' : null}<Trans {...message} values={values} /></Fragment>);
}
/** Freeze, XP and badge chips, each only when the source reports it. */
function streakChips(facts: AnimeRevealStreakFacts | undefined, badges: readonly string[]) {
  return [
    ...(facts && facts.freezesEarned > 0 ? [{ key: 'freeze', tone: 'holo', phrase: [streakCopy.chipFreeze, { count: facts.freezesEarned }] as Phrase }] : []),
    ...(facts?.milestoneXp ? [{ key: 'xp', tone: 'gold', phrase: [streakCopy.chipXp, { xp: facts.milestoneXp }] as Phrase }] : []),
    ...badges.map(badge => ({ key: `badge-${badge}`, tone: 'crimson', phrase: [streakCopy.chipBadge, { badge }] as Phrase })),
  ];
}
function StreakRewards({ facts, badges }: { facts?: AnimeRevealStreakFacts; badges: readonly string[] }) {
  return streakChips(facts, badges).map(({ key, tone, phrase: [message, values] }) => <li key={key} data-tone={tone}><Trans {...message} values={values} /></li>);
}
/** The level star carries the level reached; the move from the previous level reads in the title. */
function LevelArtifact({ currentValue }: Pick<AnimeRevealSourcePayload, 'currentValue'>) {
  return <div className="anime-reveal__level-art" aria-hidden="true"><svg viewBox="0 0 100 100"><path d="M50 4 62 36 96 37 69 59 78 91 50 72 22 91 31 59 4 37 38 36Z" /></svg><div><small>LV</small>{currentValue ? <strong>{currentValue}</strong> : null}</div></div>;
}
function LevelTitle({ previousValue, currentValue }: { previousValue?: string; currentValue: string }) {
  return <>
    <span aria-hidden="true">LV {previousValue ? <>{previousValue} <i>→</i> </> : null}{currentValue}</span>
    <span className="sr-only">{previousValue
      ? <Trans {...msg({ context: 'rewards.reveal.levelup.title-move', message: 'Level up: level {previous} to {current}' })} values={{ previous: previousValue, current: currentValue }} />
      : <Trans {...msg({ context: 'rewards.reveal.levelup.title-reached', message: 'Level up: level {current}' })} values={{ current: currentValue }} />}</span>
  </>;
}

/** The values this reveal shows, as text for the shared image; the image adds nothing the screen does not show. */
function revealShareCard(t: Translate, event: 'tierup' | 'streak', payload: AnimeRevealSourcePayload | undefined, crystal: boolean): RevealShareCard {
  const facts = event === 'streak' ? payload?.streak : undefined;
  const names = tierNames(crystal);
  const tier = (value: string) => (names[value] ? t(names[value]) : value);
  const tierup = event === 'tierup';
  return {
    kicker: t(copy[event].kicker),
    label: tierup ? payload?.lexicalLabel ?? null : null,
    hero: tierup ? payload?.headword ?? null : payload?.currentValue ?? (facts ? String(facts.length) : null),
    heroDetail: tierup ? payload?.translation ?? null : null,
    move: tierup && payload?.previousValue && payload.currentValue ? { from: tier(payload.previousValue), to: tier(payload.currentValue) } : null,
    title: payload?.title ?? (facts ? t(streakCopy.days, { count: facts.length }) : t(copy[event].title)),
    description: payload?.description ?? (facts ? streakDescription(facts).map(([message, values]) => t(message, values)).join(' ') : t(copy[event].description)),
    chips: event === 'streak'
      ? streakChips(facts, payload?.rewardLabels ?? []).map(({ phrase: [message, values] }) => t(message, values))
      : [...(payload?.rewardLabels ?? [])],
  };
}

export function AnimeReveal({ open, event, payload, onContinue, onEquip, onLater, lumiEnabled = true, reducedMotion }: AnimeRevealProps) {
  const { _, i18n } = useLingui();
  const crystal = useTheme().family === 'crystal';
  const motionReduced = reducedMotion ?? useReducedMotion();
  const [isEquipping, setIsEquipping] = useState(false);
  const [equipFailed, setEquipFailed] = useState(false);
  const [share, setShare] = useState<ShareState>(null);
  const shareRun = useRef(0);
  const isLevel = event === 'levelup';
  useEffect(() => { if (open) { setIsEquipping(false); setEquipFailed(false); } }, [open]);
  // A new reveal starts without the last one's share result, and a share still running reports nowhere.
  useEffect(() => { shareRun.current += 1; setShare(null); }, [open, event, payload]);
  useEffect(() => () => { shareRun.current += 1; }, []);
  const later = () => { if (!isEquipping) onLater(); };
  const equip = async () => { if (isEquipping) return; setIsEquipping(true); setEquipFailed(false); try { await onEquip(); } catch { setEquipFailed(true); } finally { setIsEquipping(false); } };
  const shareEvent = event === 'levelup' ? null : event;
  const shareReveal = async () => {
    if (!shareEvent || share === 'busy') return;
    const run = ++shareRun.current;
    setShare('busy');
    try {
      const card = revealShareCard((message, values) => _({ ...message, values }), shareEvent, payload, crystal);
      const { shareRevealCard } = await import('./revealShareImage');
      const outcome = await shareRevealCard(card, { locale: i18n.locale, filename: `sonflash-${shareEvent === 'tierup' ? 'tier-up' : 'streak'}.png` });
      if (run === shareRun.current) setShare(outcome);
    } catch {
      if (run === shareRun.current) setShare('error');
    }
  };
  const streakFacts = event === 'streak' ? payload?.streak : undefined;
  const artifact = event === 'tierup' ? <TierArtifact payload={payload} crystal={crystal} /> : event === 'streak' ? <StreakArtifact value={payload?.currentValue ?? (streakFacts ? String(streakFacts.length) : undefined)} /> : <LevelArtifact currentValue={payload?.currentValue} />;
  const title = payload?.title ?? (isLevel && payload?.currentValue
    ? <LevelTitle previousValue={payload.previousValue} currentValue={payload.currentValue} />
    : streakFacts ? <Trans {...streakCopy.days} values={{ count: streakFacts.length }} /> : <Trans {...copy[event].title} />);
  const description = payload?.description ?? (streakFacts ? <StreakDescription facts={streakFacts} /> : <Trans {...copy[event].description} />);
  const hasRewards = Boolean(payload?.rewardLabels?.length) || Boolean(streakFacts && (streakFacts.freezesEarned > 0 || streakFacts.milestoneXp));
  const shareOutcome = share && share !== 'busy' && share !== 'error' ? share : null;
  return <Dialog.Root open={open} onOpenChange={nextOpen => { if (!nextOpen) later(); }}><Dialog.Portal>
    <Dialog.Overlay className="anime-reveal__overlay" />
    <Dialog.Content className="anime-reveal" data-event={event} data-motion={motionReduced ? 'reduced' : 'full'} onEscapeKeyDown={event => { if (isEquipping) event.preventDefault(); }} onPointerDownOutside={event => { if (isEquipping) event.preventDefault(); }}>
      <div aria-hidden="true" className="anime-reveal__starfield" /><div aria-hidden="true" className="anime-reveal__prism" /><div aria-hidden="true" className="anime-reveal__wings" />
      {lumiEnabled ? <Lumi pose={event === 'tierup' ? 'proud' : 'happy'} size={112} className="anime-reveal__lumi" /> : null}
      <Dialog.Close className="anime-reveal__close" disabled={isEquipping} aria-label={_(msg({ id: 'rewards.reveal.close', message: 'Close reward' }))}><X size={18} aria-hidden="true" /></Dialog.Close>
      <p className="anime-reveal__kicker"><Trans {...copy[event].kicker} /></p>{artifact}<Dialog.Title className="anime-reveal__title">{title}</Dialog.Title>
      <Dialog.Description className="anime-reveal__description">{description}</Dialog.Description>
      {hasRewards ? <ul className="anime-reveal__rewards" aria-label={_(msg({ id: 'rewards.reveal.rewards-label', message: 'Unlocked rewards' }))}>
        {event === 'streak' ? <StreakRewards facts={streakFacts} badges={payload?.rewardLabels ?? []} /> : payload?.rewardLabels?.map(reward => <li key={reward}>{reward}</li>)}
      </ul> : null}
      {equipFailed ? <p className="anime-reveal__error" role="alert"><Trans {...msg({ context: 'rewards.reveal.equip-error', message: 'Could not use this reward. Try again.' })} /></p> : null}
      {share === 'error' ? <p className="anime-reveal__error" role="alert"><Trans {...msg({ context: 'rewards.reveal.share-error', message: 'Could not create the image. Try again.' })} /></p> : null}
      {shareEvent ? <p className="anime-reveal__share-status" role="status">{shareOutcome ? <Trans {...shareOutcomeCopy[shareOutcome]} /> : null}</p> : null}
      <footer className="anime-reveal__actions" data-beside-lumi={lumiEnabled || undefined}>
        {isLevel ? <button type="button" className="anime-reveal__secondary" onClick={later} disabled={isEquipping}><Trans {...msg({ context: 'rewards.reveal.later', message: 'Later' })} /></button> : null}
        {shareEvent ? <button type="button" className="anime-reveal__secondary" data-reveal-share onClick={() => { void shareReveal(); }} disabled={share === 'busy'} aria-busy={share === 'busy'}>{share === 'busy' ? <Loader2 className="animate-spin motion-reduce:animate-none" size={17} aria-hidden="true" /> : null}<Trans {...shareCopy[shareEvent]} /></button> : null}
        <button type="button" className="anime-reveal__primary" onClick={isLevel ? () => { void equip(); } : onContinue} disabled={isEquipping} aria-busy={isEquipping}>{isEquipping ? <Loader2 className="animate-spin motion-reduce:animate-none" size={17} aria-hidden="true" /> : null}<Trans {...copy[event].action} /></button>
      </footer>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
