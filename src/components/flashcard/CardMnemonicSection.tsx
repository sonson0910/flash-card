import { Brain, Lightbulb, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import React, { useState } from 'react';
import type { CardData } from '../../types/card';
import { translateText } from '../../lib/gemini';
import { triggerHaptic } from '../../lib/haptics';

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
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerateMnemonic = async (e: React.MouseEvent) => {
    e.stopPropagation();
    triggerHaptic('medium');
    setIsGenerating(true);
    setError(null);

    try {
      const prompt = `[Super-memory mnemonic request]: Create one fast Vietnamese mnemonic for the English vocabulary word "${card.word}" (${card.partOfSpeech || 'vocabulary'}) meaning "${card.translation}".
Rules:
1. Use a similar-sounding Vietnamese word or a short, funny, memorable visual story.
2. Keep it to 1–2 sentences and begin with the direct association.
3. Do not add extra characters or a long heading.`;

      const result = await translateText(prompt);
      if (!result) throw new Error('The AI returned no response.');

      const cleanedMnemonic = result.replace(/^["']|["']$/g, '').trim();

      if (onUpdateCard) {
        onUpdateCard(card.id, { mnemonic: cleanedMnemonic });
      }
    } catch {
      setError('Unable to generate mnemonic right now. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div
      className={`mnemonic-card mt-3.5 w-full p-4 text-left ${className}`}
      data-card-control
    >
      <div className="flex items-center justify-between gap-2 border-b border-amber-200/80 pb-2.5 dark:border-amber-400/20">
        <div className="flex items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-amber-200/80 text-amber-900 shadow-xs ring-1 ring-amber-400/30 dark:bg-amber-400/20 dark:text-amber-300">
            <Brain size={14} />
          </span>
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-amber-800 dark:text-amber-300">
            AI Mnemonic · Memory Hook
          </p>
        </div>

        {card.mnemonic && (
          <button
            type="button"
            data-card-control
            disabled={isGenerating}
            onPointerDown={e => e.stopPropagation()}
            onClick={handleGenerateMnemonic}
            className="flex size-7 cursor-pointer items-center justify-center rounded-full border border-amber-300/80 bg-amber-100/80 text-amber-900 transition-colors hover:bg-amber-200 disabled:opacity-50 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200 dark:hover:bg-amber-400/20 dark:hover:text-white"
            title="Generate a new mnemonic"
            aria-label="Generate a new mnemonic"
          >
            {isGenerating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          </button>
        )}
      </div>

      <div className="mt-3">
        {card.mnemonic ? (
          <div className="flex items-start gap-2.5">
            <Lightbulb size={16} className="mt-0.5 shrink-0 animate-pulse text-amber-600 drop-shadow-xs dark:text-amber-400" />
            <p className="text-xs font-semibold leading-relaxed text-amber-950 dark:text-amber-100/95">
              {card.mnemonic}
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-1">
            <button
              type="button"
              data-card-control
              data-mnemonic-generate
              disabled={isGenerating}
              onPointerDown={e => e.stopPropagation()}
              onClick={handleGenerateMnemonic}
              className="mnemonic-generate-button flex w-full cursor-pointer items-center justify-center gap-2 rounded-full px-5 py-3 text-xs font-black uppercase tracking-wider transition-[background-color,box-shadow] duration-200 disabled:opacity-60"
            >
              {isGenerating ? (
                <><Loader2 size={14} className="animate-spin" /><span>Generating memory hint…</span></>
              ) : (
                <><Sparkles size={14} /><span>Generate AI Mnemonic</span></>
              )}
            </button>
            {error && <p className="mt-2 text-xs font-medium text-rose-600 dark:text-rose-300">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
});
