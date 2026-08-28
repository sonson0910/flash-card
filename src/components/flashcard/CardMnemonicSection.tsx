import { Lightbulb, Loader2, RefreshCw, Sparkles } from 'lucide-react';
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
      className={`w-full p-4 text-left ${className}`}
      data-card-control
    >
      {card.mnemonic ? (
        <div className="flex items-start gap-2.5">
          <Lightbulb size={16} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold leading-relaxed text-amber-950 dark:text-amber-100/95">
              {card.mnemonic}
            </p>
          </div>
          <button
            type="button"
            data-card-control
            disabled={isGenerating}
            onPointerDown={e => e.stopPropagation()}
            onClick={handleGenerateMnemonic}
            className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-amber-800 transition-colors duration-200 hover:bg-amber-200/70 dark:text-amber-200 dark:hover:bg-amber-400/15 disabled:opacity-50"
            title="Generate a new mnemonic"
            aria-label="Generate a new mnemonic"
          >
            {isGenerating ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center">
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
        </div>
      )}
      {error && <p className="mt-2 text-xs font-medium text-rose-600 dark:text-rose-300">{error}</p>}
    </div>
  );
});
