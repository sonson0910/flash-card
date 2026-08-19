import * as Dialog from '@radix-ui/react-dialog';
import { Bot, Loader2, Send, Sparkles, X } from 'lucide-react';
import { useState, useRef, type FormEvent } from 'react';
import type { CardData } from '../../types/card';
import { translateText } from '../../lib/gemini';

interface CardAiAssistantModalProps {
  card: CardData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const PRESET_PROMPTS = [
  {
    label: '💼 3 ví dụ công sở',
    prompt: (word: string) => `Hãy đặt 3 câu ví dụ thực tế dùng trong môi trường làm việc/công sở bằng tiếng Anh có chứa từ "${word}", kèm dịch nghĩa tiếng Việt chi tiết cho từng câu.`,
  },
  {
    label: '🔍 Phân biệt từ đồng nghĩa',
    prompt: (word: string, synonyms?: string[]) => `Hãy giải thích sự khác biệt về sắc thái và cách dùng giữa từ "${word}" và các từ đồng nghĩa của nó (${synonyms?.join(', ') || 'các từ tương đương'}) bằng tiếng Việt ngắn gọn, dễ hiểu.`,
  },
  {
    label: '🗣️ Idioms & Cụm từ hay',
    prompt: (word: string) => `Hãy liệt kê 3 cụm từ hoặc thành ngữ (idioms/collocations) tự nhiên phổ biến nhất đi với từ "${word}", có ví dụ tiếng Anh và dịch tiếng Việt.`,
  },
];

export function CardAiAssistantModal({
  card,
  open,
  onOpenChange,
}: CardAiAssistantModalProps) {
  const [customQuery, setCustomQuery] = useState('');
  const [activeQuestion, setActiveQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const answerRef = useRef<HTMLDivElement | null>(null);

  const askAi = async (questionPrompt: string, userFriendlyLabel?: string) => {
    setActiveQuestion(userFriendlyLabel || questionPrompt);
    setIsLoading(true);
    setError(null);
    setAnswer(null);

    try {
      // Use Gemini translation/generation pipeline to query AI
      const result = await translateText(
        `[Yêu cầu học từ vựng cho từ "${card.word}" (${card.partOfSpeech || 'noun'}) mang nghĩa "${card.translation}"]: ${questionPrompt}`
      );
      if (!result) throw new Error('No answer received from AI');
      setAnswer(result);
    } catch {
      setError('AI đang bận hoặc quá tải. Bạn vui lòng thử lại sau vài giây nhé!');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCustomSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!customQuery.trim() || isLoading) return;
    const query = customQuery.trim();
    setCustomQuery('');
    void askAi(query, query);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[32px] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-6 text-[var(--sf-text)] shadow-2xl outline-none sm:p-7"
          aria-describedby={`ai-assistant-description-${card.id}`}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-2xl bg-cyan-500/15 text-cyan-600 dark:text-cyan-400">
                <Bot size={22} />
              </div>
              <div>
                <Dialog.Title className="text-balance text-lg font-black sm:text-xl">
                  Gia sư AI · <span className="capitalize text-[var(--sf-brand-text)]">{card.word}</span>
                </Dialog.Title>
                <Dialog.Description
                  id={`ai-assistant-description-${card.id}`}
                  className="mt-0.5 text-xs text-[var(--sf-text-muted)]"
                >
                  Hỏi đáp ngữ cảnh &amp; ví dụ mở rộng cho từ này.
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close
              className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-text)] transition-colors hover:border-[var(--sf-brand)]"
              aria-label="Đóng gia sư AI"
            >
              <X size={18} />
            </Dialog.Close>
          </div>

          <div className="mt-5 space-y-4">
            <div>
              <p className="mb-2 text-xs font-bold text-[var(--sf-text-muted)] uppercase tracking-wider">
                Gợi ý câu hỏi nhanh
              </p>
              <div className="flex flex-wrap gap-2">
                {PRESET_PROMPTS.map((preset, i) => (
                  <button
                    key={i}
                    type="button"
                    disabled={isLoading}
                    onClick={() => void askAi(preset.prompt(card.word, card.synonyms), preset.label)}
                    className="flex items-center gap-1.5 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-3 py-2 text-xs font-semibold text-[var(--sf-text)] transition-colors hover:border-cyan-400 hover:text-cyan-600 dark:hover:text-cyan-300 disabled:opacity-50"
                  >
                    <Sparkles size={13} className="text-cyan-500" />
                    <span>{preset.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Answer Display */}
            {(isLoading || answer || error) && (
              <div
                ref={answerRef}
                className="mt-4 rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-4 text-sm"
              >
                {activeQuestion && (
                  <p className="mb-2.5 font-bold text-xs text-cyan-600 dark:text-cyan-300 border-b border-[var(--sf-border)] pb-2 flex items-center gap-1.5">
                    <span>Q:</span> {activeQuestion}
                  </p>
                )}
                {isLoading ? (
                  <div className="flex items-center gap-2 py-3 text-xs font-bold text-[var(--sf-text-muted)]">
                    <Loader2 size={16} className="animate-spin text-[var(--sf-brand)]" />
                    <span>AI đang phân tích và viết câu trả lời…</span>
                  </div>
                ) : error ? (
                  <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">{error}</p>
                ) : (
                  <div className="whitespace-pre-line leading-relaxed text-[var(--sf-text)] text-xs sm:text-sm">
                    {answer}
                  </div>
                )}
              </div>
            )}

            {/* Custom Query Input */}
            <form onSubmit={handleCustomSubmit} className="mt-4 flex gap-2">
              <input
                type="text"
                value={customQuery}
                onChange={e => setCustomQuery(e.target.value)}
                placeholder={`Hỏi bất kỳ điều gì về từ "${card.word}"…`}
                disabled={isLoading}
                className="min-h-11 flex-1 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface)] px-3.5 text-xs text-[var(--sf-text)] placeholder:text-[var(--sf-text-muted)] focus:border-[var(--sf-brand)] focus:outline-none"
              />
              <button
                type="submit"
                disabled={!customQuery.trim() || isLoading}
                className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[var(--sf-brand)] text-[var(--sf-on-brand)] transition-colors hover:bg-[var(--sf-brand-hover)] disabled:opacity-50"
                aria-label="Gửi câu hỏi"
              >
                <Send size={16} />
              </button>
            </form>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
