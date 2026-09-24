import * as Dialog from '@radix-ui/react-dialog';
import { Loader2, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { LearningStateOutcome } from '../learning/learningStateController';
import type { CardData } from '../../types/card';
import { createEditCardDraft, editCardPatch, isSuccessfulEditCardSave, EDIT_CARD_FIELDS } from './editCardModel';

const SAVE_FAILED_MESSAGE = 'Không lưu được thay đổi. Thẻ có thể đã được sửa ở nơi khác; hãy thử lại.';

interface EditCardDialogProps {
  card: CardData;
  open: boolean;
  onOpenChange(open: boolean): void;
  onSave(cardId: string, fields: Partial<CardData>): void | Promise<LearningStateOutcome>;
}

export function EditCardDialog({ card, open, onOpenChange, onSave }: EditCardDialogProps) {
  // Captured once, when the dialog opens, so a remote sync that lands while the dialog stays open never gets
  // silently overwritten by fields the learner never touched: the patch is diffed against this snapshot, not
  // against the (possibly newer) live card.
  const [openedCard] = useState(card);
  const [draft, setDraft] = useState(() => createEditCardDraft(openedCard));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    let patch: Partial<CardData>;
    try { patch = editCardPatch(openedCard, draft); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Nội dung thẻ chưa hợp lệ.'); return; }
    if (Object.keys(patch).length === 0) { onOpenChange(false); return; }
    setSaving(true);
    setError(null);
    try {
      const outcome = await onSave(openedCard.id, patch);
      if (!isSuccessfulEditCardSave(outcome)) { setError(SAVE_FAILED_MESSAGE); return; }
      onOpenChange(false);
    } catch {
      setError(SAVE_FAILED_MESSAGE);
    } finally { setSaving(false); }
  };
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-slate-950/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[101] max-h-[90vh] w-[min(92vw,34rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-3xl border border-slate-200 bg-white p-5 text-slate-900 shadow-2xl outline-none dark:border-white/15 dark:bg-slate-900 dark:text-white">
          <div className="flex items-start justify-between gap-3">
            <div><Dialog.Title className="text-lg font-black">Sửa thẻ</Dialog.Title>
              <Dialog.Description className="text-sm text-slate-600 dark:text-slate-300">Chỉnh nội dung của “{card.word}”. Lịch ôn và nguồn thẻ được giữ nguyên.</Dialog.Description>
            </div>
            <Dialog.Close aria-label="Đóng" className="flex size-10 shrink-0 items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-white/10"><X size={18} /></Dialog.Close>
          </div>
          <form onSubmit={submit} className="mt-4 space-y-3">
            {EDIT_CARD_FIELDS.map(({ key, label, maxLength }) => <label key={key} className="block text-sm font-semibold">
              {label}
              <textarea value={draft[key]} maxLength={maxLength} rows={key === 'translation' ? 2 : 3}
                onChange={event => setDraft(previous => ({ ...previous, [key]: event.target.value }))}
                className="mt-1 min-h-11 w-full resize-y rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-normal dark:border-white/20 dark:bg-slate-950" />
            </label>)}
            {error && <p role="alert" className="text-sm font-semibold text-rose-700 dark:text-rose-300">{error}</p>}
            <button type="submit" disabled={saving} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-cyan-500 px-4 font-black text-slate-950 disabled:opacity-60">
              {saving && <Loader2 size={16} className="animate-spin" />}{saving ? 'Đang lưu…' : 'Lưu thay đổi'}
            </button>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
