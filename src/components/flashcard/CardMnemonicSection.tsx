import { Brain, Lightbulb, Loader2, RefreshCw } from 'lucide-react';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import React, { useState } from 'react';
import type { CardData } from '../../types/card';
import { generateMnemonic } from '../../lib/gemini';
import { triggerHaptic } from '../../lib/haptics';
import { RichVietnameseExplanation } from './RichVietnameseExplanation';

interface CardMnemonicSectionProps {
  card: CardData;
  onUpdateCard?: (cardId: string, updatedFields: Partial<CardData>) => void;
  className?: string;
}

export const CardMnemonicSection = React.memo(function CardMnemonicSection({
  card,
  onUpdateCard,
  className = '',
}: CardMnemonicSectionProps) {
  const { _ } = useLingui();
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerateMnemonic = async (e: React.MouseEvent) => {
    e.stopPropagation();
    triggerHaptic('medium');
    setIsGenerating(true);
    setError(null);

    try {
    const cleanedMnemonic = await generateMnemonic({
      word: card.word,
      translation: card.translation,
      partOfSpeech: card.partOfSpeech,
    });

      if (onUpdateCard) {
        onUpdateCard(card.id, { mnemonic: cleanedMnemonic });
      }
    } catch {
      setError(_(msg({ id: 'flashcard.mnemonic.error', message: 'Unable to generate mnemonic right now. Please try again.' })));
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className={`w-full ${className}`}>
      {card.mnemonic ? (
        <div className="rounded-2xl border border-amber-200/80 bg-amber-50/80 p-3 text-left dark:border-amber-400/20 dark:bg-amber-400/[0.08]">
          <div className="flex items-start gap-2.5">
            <Lightbulb size={16} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            <div className="min-w-0 flex-1"><p className="text-[10px] font-black uppercase tracking-[0.16em] text-amber-800 dark:text-amber-300"><Trans {...msg({ context: 'flashcard.mnemonic.title', message: 'AI Mnemonic · Memory Hook' })} /></p><RichVietnameseExplanation value={card.mnemonic} /></div>
            <button type="button" data-card-control disabled={isGenerating} onPointerDown={event => event.stopPropagation()} onClick={handleGenerateMnemonic} className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-amber-900 hover:bg-amber-200 disabled:opacity-50 dark:text-amber-200 dark:hover:bg-amber-400/25" aria-label={_(msg({ id: 'flashcard.mnemonic.generate', message: 'Generate a new mnemonic' }))}>{isGenerating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}</button>
          </div>
        </div>
      ) : (
        <>
          <button type="button" data-card-control data-mnemonic-generate disabled={isGenerating} onPointerDown={event => event.stopPropagation()} onClick={handleGenerateMnemonic} className="flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-full border border-amber-300/80 px-4 text-xs font-bold text-amber-900 transition-colors hover:bg-amber-100 disabled:opacity-60 dark:border-amber-400/30 dark:text-amber-200 dark:hover:bg-amber-400/15">
            {isGenerating ? <><Loader2 size={14} className="animate-spin" /><span><Trans {...msg({ context: 'flashcard.mnemonic.generating', message: 'Generating memory hint…' })} /></span></> : <><Brain size={14} /><span><Trans {...msg({ id: 'flashcard.memory-hook', message: 'Memory hook' })} /></span></>}
          </button>
          {error && <p className="mt-2 text-xs font-medium text-rose-600 dark:text-rose-300">{error}</p>}
        </>
      )}
    </div>
  );
});
