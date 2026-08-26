import type { CardData } from '../../types/card';

interface StudyCardProofProps {
  readonly card: Pick<CardData, 'word' | 'translation' | 'explanation' | 'exampleSentence' | 'mnemonic'>;
}

export function StudyCardProof({ card }: StudyCardProofProps) {
  return (
    <article
      data-study-card-proof
      aria-labelledby="study-card-proof-word"
      className="relative overflow-hidden rounded-[1.5rem] border border-cyan-100/20 bg-[#10212a] p-2 shadow-[0_30px_110px_-55px_rgba(34,211,238,.75)] sm:p-3"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(103,232,249,.16),transparent_48%)]" aria-hidden="true" />
      <div className="relative rounded-[1.15rem] border border-white/10 bg-[#0a161d]/90 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-cyan-100">Meaning revealed</p>
          <p className="rounded-full border border-cyan-100/20 bg-cyan-100/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-100">Vietnamese</p>
        </div>

        <div className="py-7 sm:py-9">
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Vietnamese meaning</p>
          <h3 id="study-card-proof-word" className="mt-3 max-w-xl text-[clamp(2.35rem,8vw,4.75rem)] font-black leading-[.95] tracking-[-0.06em] text-slate-100">{card.translation}</h3>
          <div className="mt-6 rounded-xl border border-white/10 bg-[#142630] px-4 py-3 sm:mt-7">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Original word</p>
            <p className="mt-1 text-lg font-bold text-white sm:text-xl">{card.word}</p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <section aria-labelledby="study-card-proof-explanation" className="rounded-xl border border-white/10 bg-[#071219]/80 p-4">
            <h4 id="study-card-proof-explanation" className="text-[11px] font-black uppercase tracking-[0.16em] text-cyan-100">Explanation</h4>
            <p className="mt-3 text-sm leading-6 text-slate-300">{card.explanation}</p>
          </section>
          <section aria-labelledby="study-card-proof-mnemonic" className="rounded-xl border border-cyan-100/15 bg-cyan-100/[0.06] p-4">
            <h4 id="study-card-proof-mnemonic" className="text-[11px] font-black uppercase tracking-[0.16em] text-cyan-100">Memory hook</h4>
            <p className="mt-3 text-sm font-semibold leading-6 text-slate-200">{card.mnemonic || 'Bring the word back through a vivid moment.'}</p>
          </section>
          {card.exampleSentence && (
            <section aria-labelledby="study-card-proof-context" className="rounded-xl border border-white/10 bg-[#071219]/80 p-4 sm:col-span-2">
              <h4 id="study-card-proof-context" className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">In context</h4>
              <p className="mt-3 text-sm leading-6 text-slate-300">{card.exampleSentence}</p>
            </section>
          )}
        </div>
      </div>
    </article>
  );
}
