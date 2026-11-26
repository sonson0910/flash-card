import { Lightbulb, Loader2, RefreshCw } from 'lucide-react';
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
  buttonMotionClass?: string;
}

export const CardMnemonicSection = React.memo(function CardMnemonicSection({
  card,
  onUpdateCard,
  className = '',
  buttonMotionClass = '',
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
      targetLanguage: card.language,
      translationLanguage: card.translationLanguage,
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
        <div className="flashcard-hook-panel p-3 text-left">
          <div className="flex items-start gap-2.5">
            <Lightbulb size={16} className="flashcard-hook-icon mt-0.5 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1"><p className="flashcard-hook-title text-[11px] font-bold uppercase tracking-[0.12em]"><Trans {...msg({ context: 'flashcard.mnemonic.title', message: 'AI Mnemonic · Memory Hook' })} /></p><RichVietnameseExplanation value={card.mnemonic} /></div>
            <button type="button" data-card-control disabled={isGenerating} onPointerDown={event => event.stopPropagation()} onClick={handleGenerateMnemonic} className="flashcard-hook-refresh flex min-h-11 min-w-11 items-center justify-center rounded-full disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)]" aria-label={_(msg({ id: 'flashcard.mnemonic.generate', message: 'Generate a new mnemonic' }))}>{isGenerating ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}</button>
          </div>
        </div>
      ) : (
        <>
          <button type="button" data-card-control data-mnemonic-generate disabled={isGenerating} onPointerDown={event => event.stopPropagation()} onClick={handleGenerateMnemonic} className={`flashcard-back-tool flashcard-hook-button${buttonMotionClass ? ` ${buttonMotionClass}` : ''} flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 transition-[background-color,box-shadow] duration-200 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)]`}>
            {isGenerating ? <><Loader2 size={15} className="animate-spin" aria-hidden="true" /><span className="truncate"><Trans {...msg({ context: 'flashcard.mnemonic.generating', message: 'Generating memory hint…' })} /></span></> : <><Lightbulb size={15} className="flashcard-hook-icon shrink-0" aria-hidden="true" /><span className="truncate"><Trans {...msg({ id: 'flashcard.memory-hook', message: 'Memory hook' })} /></span></>}
          </button>
          {error && <p className="mt-2 text-xs font-medium text-[var(--sf-danger)]" role="alert">{error}</p>}
        </>
      )}
    </div>
  );
});
