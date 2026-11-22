import * as Dialog from '@radix-ui/react-dialog';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { Loader2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Lumi } from '../../components/lumi/Lumi';
import { useReducedMotion } from '../../lib/motionPreferenceHooks';
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
const copy = {
  tierup: { kicker: <Trans {...msg({ context: 'rewards.reveal.tierup.kicker', message: 'Tier up' })} />, title: <Trans {...msg({ context: 'rewards.reveal.tierup.title', message: 'Mastered' })} />, description: <Trans {...msg({ context: 'rewards.reveal.tierup.description', message: 'This card is now mastered. Review it again when it is due.' })} />, action: <Trans {...msg({ context: 'rewards.reveal.tierup.continue', message: 'Continue learning' })} /> },
  streak: { kicker: <Trans {...msg({ context: 'rewards.reveal.streak.kicker', message: 'Streak milestone' })} />, title: <Trans {...msg({ context: 'rewards.reveal.streak.title', message: 'Streak reached' })} />, description: <Trans {...msg({ context: 'rewards.reveal.streak.description', message: 'Your verified review streak earned the Web Wanderer badge.' })} />, action: <Trans {...msg({ context: 'rewards.reveal.streak.continue', message: 'Keep going' })} /> },
  levelup: { kicker: <Trans {...msg({ context: 'rewards.reveal.levelup.kicker', message: 'Level up' })} />, title: <Trans {...msg({ context: 'rewards.reveal.levelup.title', message: 'Level up' })} />, description: <Trans {...msg({ context: 'rewards.reveal.levelup.description', message: 'You unlocked the Crimson Wing frame and Word Collector title. You can hold up to three hint tokens.' })} />, action: <Trans {...msg({ context: 'rewards.reveal.levelup.equip', message: 'Use frame' })} /> },
} as const;

function TierArtifact({ payload }: { payload?: AnimeRevealSourcePayload }) {
  const tierLabel = (value?: string) => value === 'new'
    ? <Trans {...msg({ context: 'rewards.reveal.tier.new', message: 'New' })} />
    : value === 'learning'
      ? <Trans {...msg({ context: 'rewards.reveal.tier.learning', message: 'Learning' })} />
      : value === 'mastered'
        ? <Trans {...msg({ context: 'rewards.reveal.tier.mastered', message: 'Mastered' })} />
        : value;
  return <div className="anime-reveal__tier-art" aria-hidden="true"><div className="anime-reveal__tier-card">
    {payload?.imageUrl ? <img src={payload.imageUrl} alt="" /> : <div className="anime-reveal__tier-image" />}
    <div>{payload?.lexicalLabel ? <small>{payload.lexicalLabel}</small> : null}{payload?.headword ? <strong>{payload.headword}</strong> : null}{payload?.translation ? <span>{payload.translation}</span> : null}
      {payload?.previousValue && payload.currentValue ? <b><span>{tierLabel(payload.previousValue)}</span> <i>→</i> <em>{tierLabel(payload.currentValue)}</em></b> : null}</div>
  </div><span className="anime-reveal__flare" /></div>;
}
function StreakArtifact({ value }: { value?: string }) {
  return <div className="anime-reveal__streak-art" aria-hidden="true"><svg viewBox="0 0 24 28"><path d="M12 1c1.3 4.2-1.8 6.6-1.8 9.8 0 1.7 1.2 3 2.8 3 1.8 0 2.9-1.4 2.6-3.6 2.8 2 4.2 5.1 4.2 8.1C19.8 23.4 16.3 27 12 27s-7.8-2.9-7.8-7.3C4.2 14.1 9.4 11.4 12 1z" /></svg>{value ? <strong>{value}</strong> : null}<span>★</span></div>;
}
function StreakDescription({ facts }: { facts: AnimeRevealStreakFacts }) {
  return <>
    {facts.length === 30
      ? <Trans id="rewards.reveal.streak.month" message="A full month of study." />
      : <Trans id="rewards.reveal.streak.run" message="{count} days of study in a row." values={{ count: facts.length }} />}
    {facts.freezesEarned > 0 ? <> <Trans id="rewards.reveal.streak.freeze-earned" message="{count, plural, one {You earned # streak freeze, so one missed day will not break the chain.} other {You earned # streak freezes, so # missed days will not break the chain.}}" values={{ count: facts.freezesEarned }} /></> : null}
    {facts.freezesEarned > 0 && facts.freezesHeld !== undefined ? <> <Trans id="rewards.reveal.streak.freeze-held" message="You now hold {count}." values={{ count: facts.freezesHeld }} /></> : null}
  </>;
}
/** Freeze, XP and badge chips, each only when the source reports it. */
function StreakRewards({ facts, badges }: { facts?: AnimeRevealStreakFacts; badges: readonly string[] }) {
  const chips = [
    ...(facts && facts.freezesEarned > 0 ? [{ key: 'freeze', tone: 'holo', label: <Trans id="rewards.reveal.streak.chip.freeze" message="{count, plural, one {+# streak freeze} other {+# streak freezes}}" values={{ count: facts.freezesEarned }} /> }] : []),
    ...(facts?.milestoneXp ? [{ key: 'xp', tone: 'gold', label: <Trans id="rewards.reveal.streak.chip.xp" message="+{xp} XP" values={{ xp: facts.milestoneXp }} /> }] : []),
    ...badges.map(badge => ({ key: `badge-${badge}`, tone: 'crimson', label: <Trans id="rewards.reveal.streak.chip.badge" message="Badge · {badge}" values={{ badge }} /> })),
  ];
  return chips.map(chip => <li key={chip.key} data-tone={chip.tone}>{chip.label}</li>);
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

export function AnimeReveal({ open, event, payload, onContinue, onEquip, onLater, lumiEnabled = true, reducedMotion }: AnimeRevealProps) {
  const { _ } = useLingui();
  const motionReduced = reducedMotion ?? useReducedMotion();
  const [isEquipping, setIsEquipping] = useState(false);
  const [equipFailed, setEquipFailed] = useState(false);
  const isLevel = event === 'levelup';
  useEffect(() => { if (open) { setIsEquipping(false); setEquipFailed(false); } }, [open]);
  const later = () => { if (!isEquipping) onLater(); };
  const equip = async () => { if (isEquipping) return; setIsEquipping(true); setEquipFailed(false); try { await onEquip(); } catch { setEquipFailed(true); } finally { setIsEquipping(false); } };
  const streakFacts = event === 'streak' ? payload?.streak : undefined;
  const artifact = event === 'tierup' ? <TierArtifact payload={payload} /> : event === 'streak' ? <StreakArtifact value={payload?.currentValue ?? (streakFacts ? String(streakFacts.length) : undefined)} /> : <LevelArtifact currentValue={payload?.currentValue} />;
  const title = payload?.title ?? (isLevel && payload?.currentValue
    ? <LevelTitle previousValue={payload.previousValue} currentValue={payload.currentValue} />
    : streakFacts ? <Trans id="rewards.reveal.streak.days" message="{count}-day streak" values={{ count: streakFacts.length }} /> : copy[event].title);
  const description = payload?.description ?? (streakFacts ? <StreakDescription facts={streakFacts} /> : copy[event].description);
  const hasRewards = Boolean(payload?.rewardLabels?.length) || Boolean(streakFacts && (streakFacts.freezesEarned > 0 || streakFacts.milestoneXp));
  return <Dialog.Root open={open} onOpenChange={nextOpen => { if (!nextOpen) later(); }}><Dialog.Portal>
    <Dialog.Overlay className="anime-reveal__overlay" />
    <Dialog.Content className="anime-reveal" data-event={event} data-motion={motionReduced ? 'reduced' : 'full'} onEscapeKeyDown={event => { if (isEquipping) event.preventDefault(); }} onPointerDownOutside={event => { if (isEquipping) event.preventDefault(); }}>
      <div aria-hidden="true" className="anime-reveal__starfield" /><div aria-hidden="true" className="anime-reveal__prism" /><div aria-hidden="true" className="anime-reveal__wings" />
      {lumiEnabled ? <Lumi pose={event === 'tierup' ? 'proud' : 'happy'} size={112} className="anime-reveal__lumi" /> : null}
      <Dialog.Close className="anime-reveal__close" disabled={isEquipping} aria-label={_(msg({ id: 'rewards.reveal.close', message: 'Close reward' }))}><X size={18} aria-hidden="true" /></Dialog.Close>
      <p className="anime-reveal__kicker">{copy[event].kicker}</p>{artifact}<Dialog.Title className="anime-reveal__title">{title}</Dialog.Title>
      <Dialog.Description className="anime-reveal__description">{description}</Dialog.Description>
      {hasRewards ? <ul className="anime-reveal__rewards" aria-label={_(msg({ id: 'rewards.reveal.rewards-label', message: 'Unlocked rewards' }))}>
        {event === 'streak' ? <StreakRewards facts={streakFacts} badges={payload?.rewardLabels ?? []} /> : payload?.rewardLabels?.map(reward => <li key={reward}>{reward}</li>)}
      </ul> : null}
      {equipFailed ? <p className="anime-reveal__error" role="alert"><Trans {...msg({ context: 'rewards.reveal.equip-error', message: 'Could not use this reward. Try again.' })} /></p> : null}
      <footer className="anime-reveal__actions" data-beside-lumi={lumiEnabled || undefined}>{isLevel ? <button type="button" className="anime-reveal__secondary" onClick={later} disabled={isEquipping}><Trans {...msg({ context: 'rewards.reveal.later', message: 'Later' })} /></button> : null}<button type="button" className="anime-reveal__primary" onClick={isLevel ? () => { void equip(); } : onContinue} disabled={isEquipping} aria-busy={isEquipping}>{isEquipping ? <Loader2 className="animate-spin motion-reduce:animate-none" size={17} aria-hidden="true" /> : null}{copy[event].action}</button></footer>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
