import * as Dialog from '@radix-ui/react-dialog';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { Loader2, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { LearningStateOutcome } from '../learning/learningStateController';
import type { CardData } from '../../types/card';
import { createEditCardDraft, editCardPatch, isSuccessfulEditCardSave, EDIT_CARD_FIELDS } from './editCardModel';

interface EditCardDialogProps {
  card: CardData;
  open: boolean;
  onOpenChange(open: boolean): void;
  onSave(cardId: string, fields: Partial<CardData>): void | Promise<LearningStateOutcome>;
}

type EditCardError = 'invalid-content' | 'save-failed';

export function EditCardDialog({ card, open, onOpenChange, onSave }: EditCardDialogProps) {
  const { _ } = useLingui();
  // Captured once, when the dialog opens, so a remote sync that lands while the dialog stays open never gets
  // silently overwritten by fields the learner never touched: the patch is diffed against this snapshot, not
  // against the (possibly newer) live card.
  const [openedCard] = useState(card);
  const [draft, setDraft] = useState(() => createEditCardDraft(openedCard));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<EditCardError | null>(null);
  const targetLanguage = card.language || 'en';
  const nativeLanguage = card.translationLanguage || 'vi';
  const saveFailedMessage = _(msg({ id: 'library.edit-card.save-failed', message: 'Your changes could not be saved. This card may have changed elsewhere. Try again.' }));
  const invalidContentMessage = _(msg({ id: 'library.edit-card.invalid-content', message: 'Check the card content and try again.' }));
  const errorMessage = error === 'save-failed' ? saveFailedMessage : error === 'invalid-content' ? invalidContentMessage : null;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    let patch: Partial<CardData>;
    try { patch = editCardPatch(openedCard, draft); }
    catch { setError('invalid-content'); return; }
    if (Object.keys(patch).length === 0) { onOpenChange(false); return; }
    setSaving(true);
    setError(null);
    try {
      const outcome = await onSave(openedCard.id, patch);
      if (!isSuccessfulEditCardSave(outcome)) { setError('save-failed'); return; }
      onOpenChange(false);
    } catch {
      setError('save-failed');
    } finally { setSaving(false); }
  };
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-slate-950/75 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[101] flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[28px] border border-[var(--sf-border)] bg-[var(--sf-surface)] text-[var(--sf-text)] shadow-2xl outline-none [html[data-theme-family=crystal]_&]:crystal-chamfer">
          <header className="flex items-start justify-between gap-4 border-b border-[var(--sf-border)] px-5 py-5 sm:px-7">
            <div className="min-w-0">
              <p className="font-display text-[11px] font-black uppercase tracking-[.16em] text-[var(--sf-text-muted)]"><Trans id="library.edit-card.kicker" message="Card editor" /></p>
              <Dialog.Title className="mt-1 font-serif text-3xl font-bold tracking-tight text-[var(--sf-text)] [html[data-theme-family=crystal]_&]:font-display [html[data-theme-family=crystal]_&]:font-black [html[data-theme-family=crystal]_&]:italic"><Trans id="library.edit-card.title" message="Edit card" /></Dialog.Title>
              <Dialog.Description className="mt-2 text-sm leading-6 text-[var(--sf-text-muted)]">
                <Trans id="library.edit-card.description" message="Changes update this card while its review history stays intact." />
              </Dialog.Description>
            </div>
            <Dialog.Close aria-label={_(msg({ id: 'library.edit-card.close', message: 'Close editor' }))} className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-text)] transition-colors hover:border-[var(--sf-brand)] focus-visible:outline-2 focus-visible:outline-offset-2 [html[data-theme-family=crystal]_&]:crystal-chamfer-sm"><X size={18} aria-hidden="true" /></Dialog.Close>
          </header>
          <form onSubmit={submit} className="overflow-y-auto px-5 py-5 sm:px-7">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <div className="rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-control)] px-4 py-3 shadow-[var(--sf-panel-shadow)] [html[data-theme-family=crystal]_&]:crystal-chamfer-sm">
                <span className="block text-[11px] font-black uppercase tracking-[.14em] text-[var(--sf-text-muted)]"><Trans id="library.edit-card.word" message="Word" /></span>
                <span lang={targetLanguage} className="mt-1 block truncate font-serif text-xl font-bold text-[var(--sf-text)] [html[data-theme-family=crystal]_&]:font-display">{card.word}</span>
              </div>
              <div className="rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-control)] px-4 py-3 shadow-[var(--sf-panel-shadow)] [html[data-theme-family=crystal]_&]:crystal-chamfer-sm">
                <span className="block text-[11px] font-black uppercase tracking-[.14em] text-[var(--sf-text-muted)]"><Trans id="library.edit-card.pronunciation" message="Pronunciation" /></span>
                <span lang={targetLanguage} className="mt-1 block truncate font-mono text-sm font-semibold text-[var(--sf-text)]">{card.phonetic || '—'}</span>
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {EDIT_CARD_FIELDS.map(({ key, maxLength }) => {
                const isNativeField = key === 'translation' || key === 'explanationTranslation' || key === 'exampleTranslation';
                const fieldLanguage = isNativeField ? nativeLanguage : targetLanguage;
                const label = key === 'translation'
                  ? <Trans id="library.edit-card.translation" message="Translation" />
                  : key === 'explanation'
                    ? <Trans id="library.edit-card.explanation" message="Definition" />
                    : key === 'explanationTranslation'
                      ? <Trans id="library.edit-card.explanation-translation" message="Definition translation" />
                      : key === 'exampleSentence'
                        ? <Trans id="library.edit-card.example" message="Example" />
                        : <Trans id="library.edit-card.example-translation" message="Example translation" />;
                return <label key={key} className={`block min-w-0 ${key === 'translation' ? 'sm:col-span-2' : ''}`}>
                  <span className="block text-xs font-black uppercase tracking-[.12em] text-[var(--sf-text-muted)]">{label}</span>
                  <textarea
                    value={draft[key]}
                    lang={fieldLanguage}
                    dir="auto"
                    maxLength={maxLength}
                    rows={key === 'translation' ? 2 : 3}
                    onChange={event => setDraft(previous => ({ ...previous, [key]: event.target.value }))}
                    className="mt-1.5 min-h-12 w-full resize-y rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-control)] px-4 py-3 text-sm leading-6 text-[var(--sf-text)] shadow-[var(--sf-panel-shadow)] outline-none placeholder:text-[var(--sf-text-muted)] focus-visible:border-[var(--sf-brand)] focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--sf-brand)_24%,transparent)] [html[data-theme-family=crystal]_&]:crystal-chamfer-sm"
                  />
                </label>;
              })}
            </div>
            <p className="mt-4 rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-4 py-3 text-sm leading-6 text-[var(--sf-text-muted)] [html[data-theme-family=crystal]_&]:crystal-chamfer-sm"><Trans id="library.edit-card.history-note" message="Your review history is kept. Changes appear on this card right away." /></p>
            {errorMessage && <p role="alert" className="mt-4 rounded-2xl border border-[var(--sf-danger)] bg-[color-mix(in_srgb,var(--sf-danger)_10%,var(--sf-surface))] px-4 py-3 text-sm font-semibold text-[var(--sf-danger)]">{errorMessage}</p>}
            <footer className="mt-5 flex flex-col-reverse gap-2 border-t border-[var(--sf-border)] pt-4 sm:flex-row sm:justify-end">
              <Dialog.Close asChild><button type="button" className="flex min-h-11 items-center justify-center rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-5 text-sm font-bold text-[var(--sf-text)] transition-colors hover:border-[var(--sf-brand)] focus-visible:outline-2 focus-visible:outline-offset-2 [html[data-theme-family=crystal]_&]:crystal-chamfer-sm"><Trans id="library.edit-card.cancel" message="Cancel" /></button></Dialog.Close>
              <button type="submit" disabled={saving} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--sf-brand)] px-5 text-sm font-bold text-[var(--sf-on-brand)] shadow-md transition-colors hover:bg-[var(--sf-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-wait disabled:opacity-60 [html[data-theme-family=crystal]_&]:crystal-chamfer-sm">
                {saving && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}<span>{saving ? <Trans id="library.edit-card.saving" message="Saving changes…" /> : <Trans id="library.edit-card.save" message="Save changes" />}</span>
              </button>
            </footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
