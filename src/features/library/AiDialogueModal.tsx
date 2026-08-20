import * as Dialog from '@radix-ui/react-dialog';
import { Check, Loader2, MessageSquare, Sparkles, Volume2, X } from 'lucide-react';
import { useState } from 'react';
import { translateText } from '../../lib/gemini';
import { playWordAudio } from '../../lib/audio';
import type { CardData } from '../../types/card';

interface AiDialogueModalProps {
  cards: CardData[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface DialogueTurn {
  speaker: string;
  en: string;
  vi: string;
}

interface DialogueResult {
  title: string;
  context: string;
  turns: DialogueTurn[];
}

export function AiDialogueContent({
  cards,
  onClose,
}: {
  cards: CardData[];
  onClose: () => void;
}) {
  const [selectedWordIds, setSelectedWordIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [dialogue, setDialogue] = useState<DialogueResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const availableCards = cards.filter(c => Boolean(c.word)).slice(0, 30);

  const toggleWordSelection = (id: string) => {
    const next = new Set(selectedWordIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      if (next.size >= 5) return;
      next.add(id);
    }
    setSelectedWordIds(next);
  };

  const selectRandomWords = () => {
    const shuffled = [...availableCards].sort(() => Math.random() - 0.5);
    const chosen = shuffled.slice(0, 4).map(c => c.id);
    setSelectedWordIds(new Set(chosen));
  };

  const handleGenerate = async () => {
    const chosenCards = cards.filter(c => selectedWordIds.has(c.id));
    const wordsList = chosenCards.length > 0
      ? chosenCards.map(c => `"${c.word}" (${c.translation})`).join(', ')
      : availableCards.slice(0, 4).map(c => `"${c.word}" (${c.translation})`).join(', ');

    setIsLoading(true);
    setError(null);
    setDialogue(null);

    try {
      const prompt = `Bạn là biên kịch đàm thoại tiếng Anh chuyên nghiệp. Hãy viết 1 đoạn hội thoại giao tiếp thực tế ngắn gọn (4-6 lượt nói) giữa 2 nhân vật (Alex và Sarah) lồng ghép tự nhiên các từ vựng sau: ${wordsList}.
Hãy trả về DUY NHẤT một chuỗi JSON hợp lệ với cấu trúc sau (không kèm markdown format ngoài):
{
  "title": "Tên ngữ cảnh ngắn gọn (Ví dụ: Tại quán cà phê / Phỏng vấn xin việc)",
  "context": "Mô tả bối cảnh ngắn 1 câu",
  "turns": [
    { "speaker": "Alex", "en": "Câu tiếng Anh của Alex", "vi": "Dịch nghĩa tiếng Việt" },
    { "speaker": "Sarah", "en": "Câu tiếng Anh của Sarah", "vi": "Dịch nghĩa tiếng Việt" }
  ]
}`;

      const rawResult = await translateText(prompt);
      if (!rawResult) throw new Error('No content returned');

      // Extract JSON cleanly
      const jsonStart = rawResult.indexOf('{');
      const jsonEnd = rawResult.lastIndexOf('}');
      if (jsonStart === -1 || jsonEnd === -1) throw new Error('Invalid JSON format');

      const parsed: DialogueResult = JSON.parse(rawResult.slice(jsonStart, jsonEnd + 1));
      if (!Array.isArray(parsed?.turns)) throw new Error('Invalid dialogue structure');
      setDialogue(parsed);
    } catch {
      setError('Không thể tạo hội thoại lúc này. Bạn thử lại nhé!');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="max-h-[calc(100dvh-2rem)] w-full overflow-y-auto rounded-[32px] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-6 text-[var(--sf-text)] shadow-2xl outline-none sm:p-7"
      aria-describedby="ai-dialogue-desc"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-lg shadow-purple-500/20">
            <MessageSquare size={24} />
          </div>
          <div>
            <h2 className="text-xl font-black text-[var(--sf-text)] sm:text-2xl">
              AI Dialogue Generator
            </h2>
            <p id="ai-dialogue-desc" className="text-xs text-[var(--sf-text-muted)]">
              Build real-life conversation scripts with your vocabulary
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-text)] transition-colors hover:border-[var(--sf-brand)]"
          aria-label="Close"
        >
          <X size={18} />
        </button>
      </div>

      {/* Word Selection Section */}
      {!dialogue && (
        <div className="mt-5 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-black uppercase tracking-wider text-[var(--sf-text-muted)]">
              Select 3–5 words ({selectedWordIds.size}/5)
            </p>
            <button
              type="button"
              onClick={selectRandomWords}
              className="text-xs font-bold text-[var(--sf-brand-text)] hover:underline"
            >
              Random pick 🎲
            </button>
          </div>

          <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto pr-1 scrollbar-none">
            {availableCards.map(c => {
              const isSelected = selectedWordIds.has(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleWordSelection(c.id)}
                  className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition-all ${
                    isSelected
                      ? 'border-purple-500 bg-purple-500/15 text-purple-600 dark:text-purple-300 ring-1 ring-purple-400'
                      : 'border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-text)] hover:border-[var(--sf-brand)]'
                  }`}
                >
                  {isSelected && <Check size={13} className="text-purple-500" />}
                  <span>{c.word}</span>
                </button>
              );
            })}
          </div>

          {error && (
            <p className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-xs text-rose-600 dark:text-rose-300 font-semibold">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={handleGenerate}
            disabled={isLoading}
            className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-500 to-purple-600 px-5 text-sm font-bold text-white shadow-lg shadow-purple-500/25 transition-all hover:opacity-95 disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                <span>AI is scripting the dialogue...</span>
              </>
            ) : (
              <>
                <Sparkles size={18} />
                <span>Generate Script</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* Dialogue Display Section */}
      {dialogue && (
        <div className="mt-5 space-y-4">
          <div className="rounded-2xl border border-purple-500/30 bg-purple-500/10 p-4">
            <h3 className="text-base font-black text-purple-600 dark:text-purple-300">
              🎭 {dialogue.title}
            </h3>
            <p className="mt-1 text-xs text-[var(--sf-text-muted)] italic">
              {dialogue.context}
            </p>
          </div>

          <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
            {dialogue.turns.map((turn, i) => (
              <div
                key={i}
                className="flex flex-col gap-1 rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-3.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-black uppercase tracking-wider text-[var(--sf-brand-text)]">
                    {turn.speaker}
                  </span>
                  <button
                    type="button"
                    onClick={() => playWordAudio(turn.en, null)}
                    className="flex size-7 items-center justify-center rounded-lg border border-[var(--sf-border)] bg-[var(--sf-surface)] text-[var(--sf-text-muted)] hover:text-[var(--sf-text)]"
                    aria-label={`Listen to ${turn.speaker}'s line`}
                  >
                    <Volume2 size={13} />
                  </button>
                </div>
                <p className="text-sm font-semibold text-[var(--sf-text)]">
                  {turn.en}
                </p>
                <p className="text-xs text-[var(--sf-text-muted)]">
                  {turn.vi}
                </p>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setDialogue(null)}
            className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-xs font-bold text-[var(--sf-text)] hover:border-[var(--sf-brand)]"
          >
            <span>Generate another script</span>
          </button>
        </div>
      )}
    </div>
  );
}

export function AiDialogueModal({ cards, open, onOpenChange }: AiDialogueModalProps) {
  if (!open) return null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2">
          <AiDialogueContent
            cards={cards}
            onClose={() => onOpenChange(false)}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
