import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { loadLanguagePack, resolveLanguagePackId } from '../../features/languagePacks/registry';
import type { HeadwordReadingPlan } from '../../features/languagePacks/types';
import type { CardData } from '../../types/card';

interface ReadingToggleProps {
  card: CardData;
  onDarkSurface?: boolean;
}

/**
 * Reading toggle for non-English target languages: Hangul romanization,
 * kana furigana, or pinyin with tones. English cards keep their existing
 * inline IPA phonetic (CardHeadword) and never render this component.
 *
 * The language pack that computes the reading is lazily imported the first
 * time a card in that language renders, so ko/ja/zh pack code never enters
 * the initial bundle. While the pack has not resolved yet - or the card has
 * no usable reading data - this renders nothing rather than a broken toggle,
 * which is the fallback contract for cards missing reading metadata.
 */
export function ReadingToggle({ card, onDarkSurface = false }: ReadingToggleProps) {
  const { _, i18n } = useLingui();
  const packId = resolveLanguagePackId(card.language);
  const [plan, setPlan] = useState<HeadwordReadingPlan | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setPlan(null);
    setExpanded(false);
    if (packId === 'en') return undefined;
    let cancelled = false;
    loadLanguagePack(packId)
      .then(pack => {
        if (cancelled) return;
        setPlan(pack.rendering.buildReadingPlan({ word: card.word, phonetic: card.phonetic }));
      })
      .catch(() => {
        if (!cancelled) setPlan(null);
      });
    return () => {
      cancelled = true;
    };
  }, [packId, card.word, card.phonetic]);

  if (packId === 'en' || !plan?.readingText) return null;

  const toggleLabel = plan.kind === 'romanization'
    ? _(msg({ id: 'flashcard.reading.toggle-romanization', message: 'Romanization' }))
    : plan.kind === 'furigana'
      ? _(msg({ id: 'flashcard.reading.toggle-furigana', message: 'Reading' }))
      : _(msg({ id: 'flashcard.reading.toggle-pinyin', message: 'Pinyin' }));
  const ariaLabel = i18n._(
    msg({ id: 'flashcard.reading.toggle-aria', message: 'Toggle {label} for {word}' }).id,
    { label: toggleLabel, word: card.word },
  );

  return (
    <div className="mt-1.5">
      <button
        type="button"
        data-card-control
        aria-pressed={expanded}
        onPointerDown={event => event.stopPropagation()}
        onClick={event => {
          event.stopPropagation();
          setExpanded(current => !current);
        }}
        aria-label={ariaLabel}
        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.1em] transition-colors ${onDarkSurface ? 'border-white/20 bg-white/10 text-slate-100 hover:bg-white/15' : 'border-slate-200/80 bg-slate-100/70 text-slate-600 hover:bg-slate-200/70 dark:border-white/10 dark:bg-white/5 dark:text-slate-300'}`}
      >
        <span>{toggleLabel}</span>
        <ChevronDown size={12} aria-hidden="true" className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <p
          lang={plan.readingLang}
          className={`mt-1.5 flex flex-wrap items-baseline gap-1.5 text-sm font-semibold ${onDarkSurface ? 'text-cyan-200' : 'text-cyan-700 dark:text-cyan-300'}`}
        >
          {plan.toneSyllables && plan.toneSyllables.length > 0
            ? plan.toneSyllables.map((syllable, index) => (
              <span key={`${syllable.text}-${index}`} className="inline-flex items-baseline">
                {syllable.text}
                <sup className="ml-0.5 text-[10px] font-black opacity-70">{syllable.tone}</sup>
              </span>
            ))
            : <span>{plan.readingText}</span>}
        </p>
      )}
    </div>
  );
}
