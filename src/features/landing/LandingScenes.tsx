import { ArrowRight, BookOpen, Brain, ChartNoAxesCombined, Check, Layers, MoveUpRight, Sparkles, Sun, Volume2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { CardData } from '../../types/card';
import { StudyCardProof } from '../../components/flashcard/StudyCardProof';

interface LandingSceneProps {
  readonly onEnterApp: () => void;
}

interface HeroSceneProps extends LandingSceneProps {
  readonly navigation: ReactNode;
}

interface ClosingSceneProps extends LandingSceneProps {
  readonly onSignIn?: () => void | Promise<void>;
  readonly user?: { displayName?: string | null; email?: string | null; photoURL?: string | null } | null;
}

const focusClass = 'focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-200';
const surfaceClass = 'border border-white/15 bg-white/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,.08),0_24px_70px_-45px_rgba(34,211,238,.45)]';

const landingStudyCard = {
  word: 'Resilience',
  translation: 'Khả năng phục hồi',
  explanation: 'Khả năng hồi phục và thích nghi sau khó khăn.',
  mnemonic: 'A young plant rises again after a storm.',
  exampleSentence: 'Her resilience helped the team recover after the setback.',
} satisfies Pick<CardData, 'word' | 'translation' | 'explanation' | 'exampleSentence' | 'mnemonic'>;

export function HeroScene({ navigation, onEnterApp }: HeroSceneProps) {
  return (
    <section id="top" aria-labelledby="landing-heading" className="relative isolate min-h-[100svh] overflow-hidden border-b border-white/10 bg-[#050a0f]">
      <div className="absolute inset-0 -z-10" aria-hidden="true">
        <img
          data-hero-image
          src="/marketing/sonflash-memory-object-v2.webp"
          alt=""
          width="1672"
          height="941"
          fetchPriority="high"
          className="size-full object-cover object-[65%_center] opacity-70 [transform:scale(1.03)]"
        />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,#050a0f_0%,rgba(5,10,15,.9)_34%,rgba(5,10,15,.35)_72%,rgba(5,10,15,.65)_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(0deg,#050a0f_0%,transparent_34%,rgba(5,10,15,.55)_100%)]" />
      </div>

      <div className="relative mx-auto flex min-h-[100svh] max-w-[96rem] flex-col px-5 py-5 sm:px-8 lg:px-12">
        {navigation}
        <div className="grid flex-1 items-center gap-10 py-14 sm:py-20 lg:grid-cols-[minmax(0,.84fr)_minmax(20rem,1.16fr)] lg:py-16">
          <div className="max-w-2xl">
            <p className="mb-5 text-sm font-semibold tracking-[0.02em] text-cyan-100">English vocabulary, remembered</p>
            <h1 id="landing-heading" className="max-w-xl text-balance text-[clamp(3.25rem,8vw,6.7rem)] font-black leading-[.92] tracking-[-0.07em] text-white">
              Words stay<br />with you.
            </h1>
            <p className="mt-7 max-w-md text-pretty text-base leading-7 text-slate-200 sm:text-lg">Capture context. Practice recall. Use the right word when it matters.</p>
            <button type="button" onClick={onEnterApp} className={`mt-8 inline-flex min-h-12 items-center gap-2 rounded-xl border border-white/60 bg-white/10 px-7 py-3 font-bold text-white shadow-[0_0_35px_-15px_rgba(165,243,252,.8)] backdrop-blur-md transition hover:border-cyan-100 hover:bg-cyan-100 hover:text-[#071014] active:scale-[.98] ${focusClass} motion-reduce:transition-none`}>
              Start learning <ArrowRight size={18} aria-hidden="true" />
            </button>
          </div>
          <div className="hidden min-h-72 lg:block" aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}

export function ProductProofScene() {
  return (
    <section id="features" aria-labelledby="features-heading" className="mx-auto max-w-[96rem] px-5 py-24 sm:px-8 sm:py-32 lg:px-12 lg:py-40">
      <div className="grid items-center gap-14 lg:grid-cols-[minmax(15rem,.65fr)_minmax(0,1.35fr)] lg:gap-24">
        <div className="max-w-lg">
          <h2 id="features-heading" className="text-balance text-4xl font-black leading-[.96] tracking-[-0.055em] text-white sm:text-6xl">Recall, made tangible.</h2>
          <p className="mt-6 max-w-md text-pretty text-lg leading-8 text-slate-300">Meaning, explanation, and memory hooks unfold in the order your mind needs them.</p>
          <dl className="mt-10 border-l border-cyan-200/35 pl-5">
            <div className="border-b border-white/15 py-5 first:pt-0">
              <dt className="font-bold text-white">Context first</dt>
              <dd className="mt-1 text-sm leading-6 text-slate-400">See the full picture before the details.</dd>
            </div>
            <div className="border-b border-white/15 py-5">
              <dt className="font-bold text-white">Adaptive review</dt>
              <dd className="mt-1 text-sm leading-6 text-slate-400">Difficulty adjusts to how you remember.</dd>
            </div>
            <div className="py-5 pb-0">
              <dt className="font-bold text-white">Four recall ratings</dt>
              <dd className="mt-1 text-sm leading-6 text-slate-400">Calibrate confidence. Strengthen recall.</dd>
            </div>
          </dl>
        </div>

        <figure className={`${surfaceClass} overflow-hidden rounded-[1.5rem] p-2 sm:p-3`}>
          <img src="/marketing/sonflash-study-preview.png" alt="SonFlash study session showing a Vietnamese meaning, explanation, memory hook, and four recall ratings" width="896" height="987" loading="lazy" className="h-auto w-full rounded-[1rem] object-cover object-top" />
          <figcaption className="px-3 py-3 text-xs leading-5 text-slate-400 sm:px-4">A real SonFlash study card, ready for recall.</figcaption>
        </figure>
      </div>
    </section>
  );
}

const journeyCards = [
  { icon: Sparkles, name: 'Capture', title: 'Save the moment you met it.', body: 'Keep the sentence, sound, and reason it mattered in one place.', word: 'resilience', detail: 'A word found in context.' },
  { icon: BookOpen, name: 'Understand', title: 'Give the word a shape.', body: 'Meaning, pronunciation, and usage become one readable card.', word: 'resilience', detail: 'the capacity to recover quickly from difficulties.' },
  { icon: Brain, name: 'Recall', title: 'Return when memory is ready.', body: 'FSRS schedules the next useful encounter, not another random pile.', word: 'resilience', detail: 'Can you bring it back?' },
  { icon: Check, name: 'Master', title: 'Reach for it naturally.', body: 'The word leaves the study screen and enters your real vocabulary.', word: 'resilience', detail: 'Use it when it matters.' },
];

function VocabularyCard({ word, detail, active }: { readonly word: string; readonly detail: string; readonly active: boolean }) {
  return (
    <div className="mx-auto flex h-full w-full max-w-xl flex-col justify-between rounded-[1.35rem] border border-white/20 bg-[#111b22] p-5 shadow-[0_30px_80px_-45px_rgba(103,232,249,.8)] sm:p-8">
      <div className="flex items-center justify-between gap-4 text-xs font-bold text-slate-300">
        <span>English card</span>
        <span className={active ? 'text-cyan-200' : 'text-slate-300'}>{active ? 'Ready' : 'Building'}</span>
      </div>
      <div className="py-10 sm:py-14">
        <p className="text-4xl font-black tracking-[-0.05em] text-white sm:text-6xl">{word}</p>
        <p className="mt-4 max-w-md text-lg leading-8 text-slate-300 sm:text-xl">{detail}</p>
      </div>
      <div className="flex items-center justify-between border-t border-white/15 pt-4 text-sm text-slate-400">
        <span>Meaning in context</span>
        <Volume2 size={18} aria-hidden="true" />
      </div>
    </div>
  );
}

export function JourneyScene() {
  return (
    <section id="methods" aria-labelledby="methods-heading" data-journey-section className="relative overflow-clip border-y border-white/10 bg-[#070e14]">
      <div className="mx-auto grid max-w-[96rem] gap-12 px-5 py-24 sm:px-8 sm:py-32 lg:grid-cols-[minmax(15rem,.63fr)_minmax(0,1.37fr)] lg:gap-20 lg:px-12 lg:py-0">
        <div className="max-w-lg lg:sticky lg:top-0 lg:flex lg:min-h-[100svh] lg:flex-col lg:justify-center lg:self-start lg:py-0">
          <h2 id="methods-heading" className="text-balance text-4xl font-black leading-[.96] tracking-[-0.055em] text-white sm:text-6xl">A word becomes usable.</h2>
          <p className="mt-6 max-w-md text-pretty text-lg leading-8 text-slate-300">Context enters first. Recall gives it weight.</p>
          <div className="mt-10 hidden items-center gap-3 text-sm font-semibold text-cyan-100 lg:flex">
            <MoveUpRight size={17} aria-hidden="true" />
            Follow the card through the loop
          </div>
        </div>

        <div data-journey-pin className="relative min-h-[36rem] lg:min-h-[100svh]">
          <div data-journey-cards className="grid gap-5 lg:absolute lg:inset-0 lg:block">
            {journeyCards.map(({ icon: Icon, name, title, body, word, detail }, index) => (
              <article key={name} data-journey-card className="relative flex min-h-[25rem] flex-col justify-between rounded-[1.5rem] border border-white/15 bg-[radial-gradient(circle_at_80%_0%,rgba(165,243,252,.12),transparent_38%),#0b151c] p-5 sm:min-h-[30rem] sm:p-8 lg:absolute lg:inset-0" style={{ zIndex: index + 1 }}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3 text-sm font-bold text-cyan-100">
                    <span className="flex size-10 items-center justify-center rounded-full border border-cyan-200/30 bg-cyan-200/10" aria-hidden="true"><Icon size={18} /></span>
                    {name}
                  </div>
                </div>
                <div className="grid items-end gap-8 md:grid-cols-[minmax(0,.9fr)_minmax(16rem,1.1fr)]">
                  <div>
                    <h3 className="max-w-sm text-3xl font-black leading-[.98] tracking-[-0.045em] text-white sm:text-5xl">{title}</h3>
                    <p className="mt-5 max-w-sm text-base leading-7 text-slate-300">{body}</p>
                  </div>
                  <div className="min-h-64">
                    <VocabularyCard word={word} detail={detail} active={index === journeyCards.length - 1} />
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export function StudyTheaterScene() {
  return (
    <section aria-labelledby="theater-heading" data-study-theater className="relative overflow-hidden px-5 py-24 sm:px-8 sm:py-32 lg:px-12 lg:py-40">
      <div className="mx-auto grid max-w-[96rem] items-center gap-12 lg:grid-cols-[minmax(0,.8fr)_minmax(28rem,1.2fr)] lg:gap-24">
        <div data-theater-copy className="max-w-xl">
          <h2 id="theater-heading" className="text-balance text-4xl font-black leading-[.96] tracking-[-0.055em] text-white sm:text-6xl">Recall without distraction.</h2>
          <p className="mt-6 max-w-md text-pretty text-lg leading-8 text-slate-300">One calm surface for meaning, memory hooks, and the next honest rating.</p>
          <div className="mt-10 grid gap-5 border-l border-cyan-200/35 pl-5">
            <div><p className="font-bold text-white">Read the whole card</p><p className="mt-1 text-sm leading-6 text-slate-400">Translation, explanation, and hook stay in one order.</p></div>
            <div><p className="font-bold text-white">Answer with your memory</p><p className="mt-1 text-sm leading-6 text-slate-400">The rating comes after the thinking, where it belongs.</p></div>
          </div>
        </div>
        <figure data-theater-figure className="relative mx-auto w-full max-w-2xl overflow-hidden rounded-[1.5rem] border border-white/15 bg-[#09141b] p-2 shadow-[0_30px_110px_-55px_rgba(34,211,238,.75)] sm:p-3">
          <StudyCardProof card={landingStudyCard} />
        </figure>
      </div>
    </section>
  );
}

export function SystemBentoScene({ onOpenProgress }: { readonly onOpenProgress?: () => void }) {
  return (
    <section aria-labelledby="system-heading" data-system-section className="border-y border-white/10 bg-[#070e14] px-5 py-24 sm:px-8 sm:py-32 lg:px-12 lg:py-40">
      <div className="mx-auto max-w-[96rem]">
        <div className="max-w-xl">
          <h2 id="system-heading" className="text-balance text-4xl font-black leading-[.96] tracking-[-0.055em] text-white sm:text-6xl">One system. Your vocabulary.</h2>
          <p className="mt-6 text-pretty text-lg leading-8 text-slate-300">Today chooses the work. Paths guide it. Your library keeps every word close.</p>
        </div>

        <div data-system-bento className="mt-12 grid grid-cols-1 gap-3 md:grid-cols-4 md:grid-rows-4 md:gap-4">
          <article className={`${surfaceClass} relative overflow-hidden rounded-[1.5rem] p-6 md:col-span-2 md:row-span-4 sm:p-8`}>
            <img src="/marketing/sonflash-memory-object-v2.webp" alt="Abstract memory object representing a connected vocabulary" width="1672" height="941" loading="lazy" className="absolute inset-0 size-full object-cover object-[64%_center] opacity-25" />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(8,17,23,.65),rgba(8,17,23,.93)_72%)]" aria-hidden="true" />
            <div className="relative flex h-full min-h-[30rem] flex-col justify-between">
              <div className="flex items-center gap-3 text-sm font-bold text-cyan-100"><Sun size={19} aria-hidden="true" /> Today</div>
              <div>
                <p className="text-sm text-slate-400">Today's word</p>
                <h3 className="mt-3 max-w-sm text-4xl font-black leading-[.98] tracking-[-0.055em] text-white sm:text-6xl">Khả năng phục hồi</h3>
                <p className="mt-3 text-lg text-slate-300">Resilience</p>
              </div>
              <div className="grid gap-4 border-t border-white/15 pt-5 sm:grid-cols-2">
                <div><p className="font-bold text-white">Focus</p><p className="mt-1 text-sm leading-6 text-slate-400">Meaning, use, and real-world context.</p></div>
                <div><p className="font-bold text-white">Why now</p><p className="mt-1 text-sm leading-6 text-slate-400">Because you have seen it. Now you own it.</p></div>
              </div>
            </div>
          </article>

          <article className={`${surfaceClass} relative overflow-hidden rounded-[1.5rem] p-6 md:col-span-1 md:row-span-2 sm:p-7`}>
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_35%,rgba(103,232,249,.22),transparent_22%),linear-gradient(135deg,rgba(103,232,249,.08),transparent_65%)]" aria-hidden="true" />
            <div className="relative flex h-full min-h-52 flex-col justify-between">
              <div className="flex items-center gap-3 text-sm font-bold text-cyan-100"><Layers size={19} aria-hidden="true" /> Paths</div>
              <div><h3 className="max-w-xs text-2xl font-black leading-tight tracking-[-0.04em] text-white">A continuous path from recognition to fluency.</h3><p className="mt-4 text-sm leading-6 text-slate-400">You do not start over. You keep going.</p></div>
            </div>
          </article>

          <article className={`${surfaceClass} relative overflow-hidden rounded-[1.5rem] p-6 md:col-span-1 md:row-span-2 sm:p-7`}>
            <img src="/marketing/sonflash-study-preview.png" alt="SonFlash card library preview" width="896" height="987" loading="lazy" className="absolute inset-0 size-full object-cover object-top opacity-25" />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(8,17,23,.7),rgba(8,17,23,.96))]" aria-hidden="true" />
            <div className="relative flex h-full min-h-52 flex-col justify-between">
              <div className="flex items-center gap-3 text-sm font-bold text-cyan-100"><BookOpen size={19} aria-hidden="true" /> Vocabulary</div>
              <div><h3 className="max-w-xs text-2xl font-black leading-tight tracking-[-0.04em] text-white">Your words. Organized by you. Always close.</h3><p className="mt-4 text-sm leading-6 text-slate-400">Search, filter, revisit. Make it truly yours.</p></div>
            </div>
          </article>

          <article className={`${surfaceClass} relative overflow-hidden rounded-[1.5rem] p-6 md:col-span-2 md:row-span-2 sm:p-7`}>
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_90%_18%,rgba(103,232,249,.25),transparent_12%),linear-gradient(120deg,rgba(103,232,249,.06),transparent_58%)]" aria-hidden="true" />
            <div className="relative flex h-full min-h-52 flex-col justify-between gap-8 sm:flex-row sm:items-end">
              <div><div className="flex items-center gap-3 text-sm font-bold text-cyan-100"><ChartNoAxesCombined size={19} aria-hidden="true" /> Progress</div><h3 className="mt-8 max-w-xs text-3xl font-black leading-tight tracking-[-0.045em] text-white">Quiet progress. Real change.</h3><p className="mt-3 max-w-xs text-sm leading-6 text-slate-400">Learning you can feel in how you think, speak, and remember.</p></div>
              <button type="button" onClick={onOpenProgress} className={`inline-flex min-h-11 items-center gap-2 self-start rounded-xl border border-white/20 px-4 text-sm font-bold text-white transition hover:border-cyan-100 hover:bg-white/10 sm:self-end ${focusClass} motion-reduce:transition-none`}>Open progress <MoveUpRight size={16} aria-hidden="true" /></button>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}

export function ClosingScene({ onEnterApp, onSignIn, user }: ClosingSceneProps) {
  return (
    <section aria-labelledby="closing-heading" className="relative overflow-hidden px-5 py-24 sm:px-8 sm:py-32 lg:px-12 lg:py-40">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_70%_20%,rgba(103,232,249,.12),transparent_32%),linear-gradient(135deg,#081017,#050a0f_68%)]" aria-hidden="true" />
      <div className="mx-auto grid max-w-[96rem] items-center gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(20rem,.9fr)] lg:gap-20">
        <div>
          <h2 id="closing-heading" className="max-w-3xl text-balance text-5xl font-black leading-[.92] tracking-[-0.065em] text-white sm:text-7xl">Make the next word yours.</h2>
          <p className="mt-7 max-w-md text-pretty text-lg leading-8 text-slate-300">Start with a word you need. SonFlash will help you keep it.</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <button type="button" onClick={onEnterApp} className={`inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-cyan-100 px-7 py-3 font-black text-[#071014] shadow-[0_0_45px_-18px_rgba(165,243,252,.9)] transition hover:bg-white active:scale-[.98] sm:w-auto ${focusClass} motion-reduce:transition-none`}>Start learning <ArrowRight size={18} aria-hidden="true" /></button>
            {onSignIn && !user && <button type="button" onClick={() => void onSignIn()} className={`min-h-12 w-full rounded-xl border border-white/25 px-7 py-3 font-bold text-white transition hover:border-cyan-100 hover:bg-white/10 sm:w-auto ${focusClass} motion-reduce:transition-none`}>Sign in with Google</button>}
          </div>
        </div>
        <div className="relative mx-auto w-full max-w-md rotate-[-5deg] overflow-hidden rounded-[1.5rem] border border-cyan-100/45 bg-white/[0.06] p-3 shadow-[0_30px_90px_-45px_rgba(165,243,252,.8)]">
          <img src="/marketing/sonflash-memory-object-v2.webp" alt="A SonFlash memory card ready to become part of your vocabulary" width="1672" height="941" loading="lazy" className="aspect-[1.1] w-full rounded-[1rem] object-cover object-[64%_center] opacity-80" />
          <div className="absolute inset-x-8 bottom-8 rounded-xl border border-white/20 bg-[#0a141b]/95 p-4"><p className="text-sm font-bold text-cyan-100">clarity</p><p className="mt-1 text-xs text-slate-300">the quality of being clear, easy to understand or perceive.</p></div>
        </div>
      </div>
    </section>
  );
}
