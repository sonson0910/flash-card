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
      const prompt = `[Yêu cầu tạo Mẹo Ghi Nhớ Siêu Trí Nhớ (Mnemonic)]: Hãy tạo 1 câu mẹo nhớ siêu tốc bằng tiếng Việt cho từ vựng tiếng Anh "${card.word}" (${card.partOfSpeech || 'từ vựng'}) mang nghĩa "${card.translation}".
Quy tắc:
1. Sử dụng phương pháp liên tưởng âm thanh tương tự (cách đọc nghe na ná từ tiếng Việt) hoặc tạo câu chuyện hình ảnh ngắn gọn, hài hước, gây ấn tượng mạnh.
2. Viết ngắn gọn trong 1-2 câu, bắt đầu bằng lời giải thích liên tưởng trực diện.
3. Không thêm các ký tự thừa hay tiêu đề dài dòng.`;

      const result = await translateText(prompt);
      if (!result) throw new Error('Không nhận được phản hồi từ AI');

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
      className={`mt-3.5 w-full rounded-[24px] border border-amber-400/35 bg-gradient-to-br from-amber-500/15 via-amber-500/5 to-transparent p-4 text-left shadow-[0_16px_35px_-10px_rgba(251,191,36,0.18),inset_0_1px_0_rgba(255,255,255,0.2)] backdrop-blur-2xl transition-all ${className}`}
      data-card-control
    >
      <div className="flex items-center justify-between gap-2 border-b border-amber-400/20 pb-2.5">
        <div className="flex items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-amber-400/20 text-amber-300 shadow-xs ring-1 ring-amber-400/30">
            <Brain size={14} />
          </span>
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-amber-300">
              AI Mnemonic · Memory Hook
            </p>
          </div>
        </div>

        {card.mnemonic && (
          <button
            type="button"
            data-card-control
            disabled={isGenerating}
            onPointerDown={e => e.stopPropagation()}
            onClick={handleGenerateMnemonic}
            className="flex size-7 items-center justify-center rounded-full border border-amber-400/20 bg-amber-400/10 text-amber-200 transition-colors hover:bg-amber-400/20 hover:text-white disabled:opacity-50 cursor-pointer"
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
            <Lightbulb size={16} className="mt-0.5 shrink-0 text-amber-400 animate-pulse drop-shadow-sm" />
            <p className="text-xs font-semibold leading-relaxed text-amber-100/95">
              {card.mnemonic}
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-1">
            <button
              type="button"
              data-card-control
              disabled={isGenerating}
              onPointerDown={e => e.stopPropagation()}
              onClick={handleGenerateMnemonic}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-amber-400 via-amber-300 to-yellow-300 py-3 px-5 text-xs font-black uppercase tracking-wider text-[#071014] shadow-lg shadow-amber-500/25 transition-all hover:scale-[1.02] hover:from-amber-300 active:scale-[0.98] disabled:opacity-60 cursor-pointer"
            >
              {isGenerating ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Generating memory hint…</span>
                </>
              ) : (
                <>
                  <Sparkles size={14} />
                  <span>⚡ Generate AI Mnemonic</span>
                </>
              )}
            </button>
            {error && <p className="mt-2 text-xs font-medium text-rose-300">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
});
