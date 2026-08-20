import * as Dialog from '@radix-ui/react-dialog';
import { Check, Loader2, Plus, ScanText, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { translateText } from '../../lib/gemini';

interface ExtractedWordItem {
  word: string;
  translation: string;
  partOfSpeech: string;
  cefrLevel: string;
  example: string;
}

interface WordExtractorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportWords: (words: string[]) => void;
}

export function WordExtractorContent({
  onClose,
  onImportWords,
}: {
  onClose: () => void;
  onImportWords: (words: string[]) => void;
}) {
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [extractedWords, setExtractedWords] = useState<ExtractedWordItem[]>([]);
  const [selectedWords, setSelectedWords] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const handleExtract = async () => {
    if (!inputText.trim()) return;

    setIsLoading(true);
    setError(null);
    setExtractedWords([]);
    setSelectedWords(new Set());

    try {
      const prompt = `Bạn là chuyên gia trích xuất từ vựng tiếng Anh. Hãy đọc đoạn văn bản sau và chọn lọc ra 5-10 từ vựng hoặc cụm từ học thuật/thực tế hay nhất (trình độ B1-C2):
"${inputText.trim().slice(0, 2000)}"

Trả về DUY NHẤT một chuỗi JSON hợp lệ theo định dạng mảng (không thêm markdown ngoài):
[
  {
    "word": "từ vựng tiếng Anh",
    "translation": "nghĩa tiếng Việt ngắn gọn",
    "partOfSpeech": "noun/verb/adj...",
    "cefrLevel": "B1/B2/C1/C2",
    "example": "câu ví dụ ngắn trích từ bài hoặc tự đặt"
  }
]`;

      const rawResult = await translateText(prompt);
      if (!rawResult) throw new Error('No response from AI');

      const jsonStart = rawResult.indexOf('[');
      const jsonEnd = rawResult.lastIndexOf(']');
      if (jsonStart === -1 || jsonEnd === -1) throw new Error('Invalid JSON format');

      const parsed: ExtractedWordItem[] = JSON.parse(rawResult.slice(jsonStart, jsonEnd + 1));
      if (!Array.isArray(parsed)) throw new Error('Invalid JSON structure');
      setExtractedWords(parsed);
      setSelectedWords(new Set(parsed.map(item => item.word)));
    } catch {
      setError('Could not extract vocabulary from this text. Please try again!');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleSelect = (word: string) => {
    const next = new Set(selectedWords);
    if (next.has(word)) next.delete(word);
    else next.add(word);
    setSelectedWords(next);
  };

  const handleAddAllSelected = () => {
    const list = Array.from(selectedWords);
    if (list.length > 0) {
      onImportWords(list);
      onClose();
      setInputText('');
      setExtractedWords([]);
    }
  };

  return (
    <div
      className="max-h-[calc(100dvh-2rem)] w-full overflow-y-auto rounded-[32px] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-6 text-[var(--sf-text)] shadow-2xl outline-none sm:p-7"
      aria-describedby="extractor-desc"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-600 text-white shadow-lg shadow-teal-500/20">
            <ScanText size={24} />
          </div>
          <div>
            <h2 className="text-xl font-black text-[var(--sf-text)] sm:text-2xl">
              Scan & Extract Vocabulary
            </h2>
            <p id="extractor-desc" className="text-xs text-[var(--sf-text-muted)]">
              Paste an article or paragraph and let AI extract high-value words
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

      <div className="mt-5 space-y-4">
        <div>
          <label htmlFor="extractor-input" className="block mb-2 text-xs font-black uppercase tracking-wider text-[var(--sf-text-muted)]">
            English Text Passage
          </label>
          <textarea
            id="extractor-input"
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            placeholder="Paste a paragraph, email, IELTS reading passage or book page here..."
            rows={4}
            className="w-full rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-3.5 text-xs leading-relaxed text-[var(--sf-text)] placeholder:text-[var(--sf-text-muted)] focus:border-[var(--sf-brand)] focus:outline-hidden"
          />
        </div>

        {error && (
          <p className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-xs font-semibold text-rose-600 dark:text-rose-300">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={handleExtract}
          disabled={isLoading || !inputText.trim()}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 px-5 text-sm font-bold text-white shadow-lg shadow-teal-500/25 transition-all hover:opacity-95 disabled:opacity-50"
        >
          {isLoading ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              <span>AI is analyzing the text...</span>
            </>
          ) : (
            <>
              <Sparkles size={18} />
              <span>Extract Vocabulary</span>
            </>
          )}
        </button>

        {/* Extracted Words Result List */}
        {extractedWords.length > 0 && (
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black uppercase tracking-wider text-[var(--sf-text-muted)]">
                Words found ({selectedWords.size}/{extractedWords.length})
              </span>
              <button
                type="button"
                onClick={() => {
                  if (selectedWords.size === extractedWords.length) setSelectedWords(new Set());
                  else setSelectedWords(new Set(extractedWords.map(w => w.word)));
                }}
                className="text-xs font-bold text-[var(--sf-brand-text)] hover:underline"
              >
                {selectedWords.size === extractedWords.length ? 'Deselect all' : 'Select all'}
              </button>
            </div>

            <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
              {extractedWords.map((item, i) => {
                const isSelected = selectedWords.has(item.word);
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => toggleSelect(item.word)}
                    className={`flex w-full items-start gap-3 rounded-2xl border p-3 text-left transition-all ${
                      isSelected
                        ? 'border-teal-500 bg-teal-500/10'
                        : 'border-[var(--sf-border)] bg-[var(--sf-surface-raised)] opacity-70'
                    }`}
                  >
                    <div
                      className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border ${
                        isSelected
                          ? 'border-teal-500 bg-teal-500 text-white'
                          : 'border-[var(--sf-border)] bg-[var(--sf-surface)]'
                      }`}
                    >
                      {isSelected && <Check size={13} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-black text-[var(--sf-text)] text-sm">{item.word}</span>
                        <span className="rounded-md bg-[var(--sf-surface-muted)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--sf-text-muted)]">
                          {item.cefrLevel || item.partOfSpeech}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--sf-text-muted)] mt-0.5">{item.translation}</p>
                    </div>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={handleAddAllSelected}
              disabled={selectedWords.size === 0}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--sf-brand)] px-4 text-xs font-bold text-[var(--sf-on-brand)] shadow-md transition-all hover:bg-[var(--sf-brand-hover)] disabled:opacity-50"
            >
              <Plus size={16} />
              <span>Create {selectedWords.size} flashcards now</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function WordExtractorModal({ open, onOpenChange, onImportWords }: WordExtractorModalProps) {
  if (!open) return null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2">
          <WordExtractorContent
            onClose={() => onOpenChange(false)}
            onImportWords={onImportWords}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
