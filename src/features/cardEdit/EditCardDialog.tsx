import * as AlertDialog from '@radix-ui/react-alert-dialog';
import * as Dialog from '@radix-ui/react-dialog';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { Check, ImageOff, Loader2, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { LearningStateOutcome } from '../learning/learningStateController';
import type { CardData } from '../../types/card';
import {
  cardEditCloudAvailable,
  CardHeadwordRenameError,
  mirrorCardCategoryEdit,
  renameOwnCardHeadword,
} from './cardEditService';
import { fetchImageUrl, getDisplayImageUrl } from '../../lib/images';
import {
  canEditPartOfSpeech,
  createEditCardDraft,
  editCardPatch,
  EDIT_CARD_FIELDS,
  isEditCardDraftDirty,
  isSuccessfulEditCardSave,
  MAX_CATEGORY_LENGTH,
  MAX_HEADWORD_LENGTH,
  MAX_PART_OF_SPEECH_LENGTH,
  previewEditCard,
  type EditableCardField,
  type EditCardDraft,
} from './editCardModel';

export interface EditCardDialogProps {
  card: CardData;
  open: boolean;
  onOpenChange(open: boolean): void;
  onSave(cardId: string, fields: Partial<CardData>): void | Promise<LearningStateOutcome>;
  onDelete?(cardId: string): Promise<boolean>;
  context?: EditCardDialogContext;
}

export interface EditCardDialogContext {
  kind: 'review';
  current: number;
  total: number;
}

type EditCardError = 'invalid-content' | 'save-failed';

const fieldLabels = {
  translation: msg({ id: 'library.edit-card.translation', message: 'Translation' }),
  explanation: msg({ id: 'library.edit-card.explanation', message: 'Definition' }),
  explanationTranslation: msg({ id: 'library.edit-card.explanation-translation', message: 'Definition translation' }),
  exampleSentence: msg({ id: 'library.edit-card.example', message: 'Example' }),
  exampleTranslation: msg({ id: 'library.edit-card.example-translation', message: 'Example translation' }),
  phonetic: null,
  mnemonic: msg({ id: 'flashcard.memory-hook', message: 'Memory hook' }),
} satisfies Record<EditableCardField, ReturnType<typeof msg> | null>;

const isNativeField = (key: EditableCardField) =>
  key !== 'explanation' && key !== 'exampleSentence' && key !== 'phonetic';

// Mirrors the server's and the client normalizer's http/https-only rule: even
// though `source.url` was already sanitized before persistence, this display
// boundary re-checks it independently rather than trusting the stored shape.
const isDisplayableSourceUrl = (value: string | undefined): value is string => {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const fieldRows = (key: EditableCardField) => {
  if (key === 'translation') return 2;
  if (key === 'phonetic') return 1;
  if (key === 'mnemonic') return 3;
  return 3;
};

const textareaClass = 'mt-1.5 min-h-12 w-full resize-y rounded-[var(--sf-card-radius)] border border-[var(--sf-border)] bg-[var(--sf-surface-control)] px-4 py-3 text-sm leading-6 text-[var(--sf-text)] shadow-[var(--sf-panel-shadow)] outline-none placeholder:text-[var(--sf-text-muted)] focus-visible:border-[var(--sf-brand)] focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--sf-brand)_24%,transparent)] [html[data-theme-family=crystal]_&]:crystal-chamfer-sm';
const fieldClasses = (key: EditableCardField) => `${textareaClass}${key === 'phonetic' ? ' font-mono' : ''}${key === 'mnemonic' ? ' border-[color-mix(in_srgb,var(--sf-reward)_45%,var(--sf-border))] bg-[color-mix(in_srgb,var(--sf-reward)_9%,var(--sf-surface-control))]' : ''}`;

const secondaryButtonClass = 'flex min-h-11 items-center justify-center rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-5 text-sm font-bold text-[var(--sf-text)] transition-colors hover:border-[var(--sf-brand)] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-wait disabled:opacity-60 [html[data-theme-family=crystal]_&]:crystal-chamfer-sm';
const dangerButtonClass = 'flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--sf-danger)] px-5 text-sm font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-wait disabled:opacity-60 [html[data-theme-family=crystal]_&]:crystal-chamfer-sm';
const textInputClass = 'mt-1.5 min-h-11 w-full rounded-[var(--sf-card-radius)] border border-[var(--sf-border)] bg-[var(--sf-surface-control)] px-4 text-sm text-[var(--sf-text)] outline-none focus-visible:border-[var(--sf-brand)] focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--sf-brand)_24%,transparent)] [html[data-theme-family=crystal]_&]:crystal-chamfer-sm';
const dirtyBadgeClass = 'shrink-0 rounded-md border border-[color-mix(in_srgb,var(--sf-reward)_60%,var(--sf-border))] bg-[color-mix(in_srgb,var(--sf-reward)_14%,var(--sf-surface))] px-1.5 py-0.5 text-[10px] font-black uppercase tracking-[.08em] text-[var(--sf-reward)]';
const fieldLabelClass = 'block text-xs font-black uppercase tracking-[.12em] text-[var(--sf-text-muted)]';
const noteClass = 'rounded-[var(--sf-card-radius)] border border-dashed border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-4 py-3 text-xs leading-5 text-[var(--sf-text-muted)] [html[data-theme-family=crystal]_&]:crystal-chamfer-sm';

export function EditCardDialog({ card, open, onOpenChange, onSave, onDelete, context }: EditCardDialogProps) {
  const { _ } = useLingui();
  // The snapshot is intentionally stable while the sheet is open. A remote
  // update to a field the learner never touched therefore stays out of the
  // submitted patch.
  const [openedCard, setOpenedCard] = useState(card);
  const [draft, setDraft] = useState<EditCardDraft>(() => createEditCardDraft(card));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<EditCardError | null>(null);
  const [confirmation, setConfirmation] = useState<'discard' | 'delete' | null>(null);
  const [deleteStatus, setDeleteStatus] = useState<'idle' | 'working' | 'failure'>('idle');
  // The headword commits through its own action (see `saveWord`), independently
  // from the draft above, because Rules lock `word`/`normalizedWord` on any card
  // that already has an identity: a rename always goes through the dedicated
  // `renameCardHeadword` callable, never through the plain-patch pipeline.
  const [wordDraft, setWordDraft] = useState(card.word);
  const [renamingWord, setRenamingWord] = useState(false);
  const [wordError, setWordError] = useState<'invalid' | 'conflict' | 'duplicate' | 'failed' | null>(null);
  const [imageSearching, setImageSearching] = useState(false);
  const [imageSearchFailed, setImageSearchFailed] = useState(false);
  const firstFieldRef = useRef<HTMLTextAreaElement | null>(null);
  const wasOpenRef = useRef(open);
  const cardIdRef = useRef(card.id);

  useEffect(() => {
    const reopened = open && !wasOpenRef.current;
    const cardChanged = cardIdRef.current !== card.id;
    if (reopened || cardChanged) {
      setOpenedCard(card);
      setDraft(createEditCardDraft(card));
      setError(null);
      setConfirmation(null);
      setDeleteStatus('idle');
      setWordDraft(card.word);
      setRenamingWord(false);
      setWordError(null);
      setImageSearching(false);
      setImageSearchFailed(false);
    }
    wasOpenRef.current = open;
    cardIdRef.current = card.id;
  }, [card, open]);

  // The headword rename callable is the only way this dialog can be Rules-
  // safe for an identified card; without a configured Firebase project there
  // is no callable to reach, so the control degrades to its old read-only
  // presentation instead of offering an action that would always fail.
  const canRenameWord = cardEditCloudAvailable;

  const targetLanguage = openedCard.language || 'en';
  const nativeLanguage = openedCard.translationLanguage || 'vi';
  const deleting = deleteStatus === 'working';
  const writing = saving || renamingWord || deleting;
  const wordDirty = wordDraft.trim() !== openedCard.word;
  const dirty = wordDirty || isEditCardDraftDirty(openedCard, draft);
  const previewCard = previewEditCard(openedCard, draft);
  const errorMessage = error && _(error === 'save-failed'
    ? msg({ id: 'library.edit-card.save-failed', message: 'Your changes could not be saved. This card may have changed elsewhere. Try again.' })
    : msg({ id: 'library.edit-card.invalid-content', message: 'Check the card content and try again.' }));
  const wordErrorMessage = wordError && _(wordError === 'invalid'
    ? msg({ id: 'library.edit-card.word-too-long', message: 'Word is too long.' })
    : wordError === 'duplicate'
      ? msg({ id: 'library.edit-card.word-duplicate', message: 'Another card already uses this word.' })
      : wordError === 'conflict'
        ? msg({ id: 'library.edit-card.word-conflict', message: 'This card changed elsewhere. Reload and try again.' })
        : msg({ id: 'library.edit-card.word-save-failed', message: 'The word could not be saved. Try again.' }));
  const imageSearchFailedMessage = _(msg({ id: 'library.edit-card.image-search-failed', message: 'No new photo was found. Try again in a moment.' }));

  const closeSheet = (force = false) => {
    if (writing) return;
    if (!force && dirty) {
      setConfirmation('discard');
      return;
    }
    setConfirmation(null);
    onOpenChange(false);
  };

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      onOpenChange(true);
      return;
    }
    closeSheet();
  };

  // Commits a headword correction on its own, one Firestore transaction on
  // the server via the trusted callable — kept independent from the main
  // form's patch so the two write paths (Admin-SDK callable vs. client
  // Firestore update) never have to reconcile a single combined save.
  const saveWord = async (fromSubmit = false): Promise<CardData | null> => {
    if (renamingWord || (saving && !fromSubmit)) return null;
    const nextWord = wordDraft.trim();
    if (nextWord === openedCard.word) {
      setWordError(null);
      return openedCard;
    }
    if (!nextWord || nextWord.length > MAX_HEADWORD_LENGTH) {
      setWordError('invalid');
      return null;
    }
    setRenamingWord(true);
    setWordError(null);
    try {
      const renamed = await renameOwnCardHeadword(openedCard, nextWord);
      setOpenedCard(renamed);
      setWordDraft(renamed.word);
      return renamed;
    } catch (renameError) {
      if (renameError instanceof CardHeadwordRenameError) {
        setWordError(renameError.reason === 'duplicate-word' ? 'duplicate' : 'conflict');
      } else {
        setWordError('failed');
      }
      return null;
    } finally {
      setRenamingWord(false);
    }
  };

  // Reuses the same protected search the AI creation flow uses, in the
  // learner's current draft context rather than the live card, so a photo
  // found right after editing the meaning matches what is about to be saved.
  const findAnotherPhoto = async () => {
    if (imageSearching || writing) return;
    setImageSearching(true);
    setImageSearchFailed(false);
    try {
      const searchQuery = draft.translation.trim() || openedCard.translation;
      const found = await fetchImageUrl({
        word: openedCard.word,
        searchQuery,
        category: draft.category,
        partOfSpeech: draft.partOfSpeech,
        explanation: draft.explanation,
      });
      if (found) {
        setDraft(previous => ({ ...previous, imageUrl: found, imageSearchQuery: searchQuery }));
      } else {
        setImageSearchFailed(true);
      }
    } catch {
      setImageSearchFailed(true);
    } finally {
      setImageSearching(false);
    }
  };

  const removeImage = () => {
    if (writing) return;
    setDraft(previous => ({ ...previous, imageUrl: '', imageSearchQuery: '' }));
    setImageSearchFailed(false);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (writing) return;
    let patch: Partial<CardData>;
    try {
      patch = editCardPatch(openedCard, draft);
    } catch {
      setError('invalid-content');
      return;
    }
    if (Object.keys(patch).length === 0 && !wordDirty) {
      closeSheet();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let cardToSave = openedCard;
      if (wordDirty) {
        const renamed = await saveWord(true);
        if (!renamed) return;
        cardToSave = renamed;
        patch = editCardPatch(cardToSave, draft);
      }
      if (Object.keys(patch).length === 0) {
        closeSheet(true);
        return;
      }
      const outcome = await onSave(cardToSave.id, patch);
      if (!isSuccessfulEditCardSave(outcome)) {
        setError('save-failed');
        return;
      }
      // The facets mirror must never gate the save the learner is waiting on.
      if (Object.prototype.hasOwnProperty.call(patch, 'category')) {
        mirrorCardCategoryEdit(cardToSave, patch.category as string);
      }
      closeSheet(true);
    } catch {
      setError('save-failed');
    } finally {
      setSaving(false);
    }
  };

  const deleteCard = async () => {
    if (!onDelete || deleting) return;
    setDeleteStatus('working');
    if (await onDelete(openedCard.id).catch(() => false)) {
      setConfirmation(null);
      onOpenChange(false);
      return;
    }
    setDeleteStatus('failure');
  };

  return (
    <>
      <Dialog.Root open={open} onOpenChange={handleDialogOpenChange}>
        <Dialog.Portal>
          <div data-edit-preview-backdrop aria-hidden="true" style={{ background: 'var(--sf-canvas)' }} className="pointer-events-none fixed inset-0 z-[99] hidden items-center justify-center pr-[440px] [html[data-theme-family=crystal]_&]:pr-[540px] md:flex">
            <div className="w-[min(400px,34vw)] overflow-hidden rounded-[var(--sf-card-radius)] border border-[color-mix(in_srgb,var(--sf-brand)_55%,var(--sf-border))] bg-[var(--sf-card-bg)] shadow-[0_30px_70px_-30px_var(--sf-shadow)] [html[data-theme-family=crystal]_&]:crystal-chamfer">
              {previewCard.imageUrl ? <img src={previewCard.imageUrl} alt="" className="h-48 w-full object-cover [html[data-theme-family=crystal]_&]:crystal-chamfer-sm" /> : <div className="flex h-48 items-center justify-center bg-[var(--sf-surface-raised)] text-6xl font-black text-[var(--sf-brand-text)]">{previewCard.word.slice(0, 1).toUpperCase()}</div>}
              <div className="p-6">
                <p className="text-[10px] font-black uppercase tracking-[.14em] text-[var(--sf-text-muted)]">{previewCard.partOfSpeech || 'Card preview'} <Trans {...msg({ context: 'library.edit-card.editing-badge', message: '· editing' })} /></p>
                <p className="mt-2 font-serif text-5xl font-bold leading-none text-[var(--sf-text)] [html[data-theme-family=crystal]_&]:font-display [html[data-theme-family=crystal]_&]:font-black [html[data-theme-family=crystal]_&]:italic">{previewCard.word}</p>
                <p className="mt-2 font-mono text-sm text-[var(--sf-text-muted)]">{previewCard.phonetic || '—'}</p>
                <div className="mt-16 flex items-center gap-2 border-t border-[var(--sf-border)] pt-3">
                  <p className="min-w-0 truncate font-serif text-2xl font-semibold text-[var(--sf-brand-text)] [html[data-theme-family=crystal]_&]:font-display [html[data-theme-family=crystal]_&]:font-black [html[data-theme-family=crystal]_&]:italic">{previewCard.translation || '—'}</p>
                  {dirty && <span className={dirtyBadgeClass}><Trans {...msg({ context: 'library.edit-card.unsaved-badge', message: 'Unsaved' })} /></span>}
                </div>
              </div>
            </div>
          </div>
          <Dialog.Overlay data-edit-overlay className="fixed inset-0 z-[98] bg-slate-950/75 backdrop-blur-sm" />
          <Dialog.Content
            data-card-edit-sheet
            onOpenAutoFocus={event => {
              event.preventDefault();
              firstFieldRef.current?.focus();
            }}
            className="fixed inset-x-0 bottom-0 z-[101] flex max-h-[min(92dvh,780px)] w-full translate-x-0 translate-y-0 flex-col overflow-hidden rounded-t-[28px] border border-b-0 border-[var(--sf-border)] bg-[var(--sf-surface)] [background-image:var(--sf-dialog-bg)] text-[var(--sf-text)] shadow-2xl outline-none md:inset-y-0 md:left-auto md:right-0 md:top-0 md:max-h-none md:w-[440px] md:rounded-none md:border-b md:border-r-0 md:border-t-0 md:border-l [html[data-theme-family=crystal]_&]:crystal-chamfer [html[data-theme-family=crystal]_&]:md:w-[540px]"
          >
            <div aria-hidden="true" className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-[var(--sf-border)] md:hidden" />
            <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--sf-border)] px-5 pb-4 pt-4 sm:px-7 sm:pt-5 md:px-[26px]">
              <div className="min-w-0">
                <p className="font-display text-[11px] font-black uppercase tracking-[.14em] text-[var(--sf-text-muted)]">
                  {context ? <Trans {...msg({ id: 'library.edit-card.review-kicker', message: 'Card {current} of {total}' })} values={{ current: context.current, total: context.total }} /> : <Trans {...msg({ context: 'library.edit-card.kicker', message: 'Card editor' })} />}
                </p>
                <Dialog.Title className="mt-1 font-serif text-3xl font-bold tracking-tight text-[var(--sf-text)] [html[data-theme-family=crystal]_&]:font-display [html[data-theme-family=crystal]_&]:font-black [html[data-theme-family=crystal]_&]:italic">
                  <Trans {...msg({ context: 'library.edit-card.title', message: 'Edit card' })} />
                </Dialog.Title>
                <Dialog.Description className="mt-2 max-w-[34rem] text-sm leading-6 text-[var(--sf-text-muted)]">
                  {context ? <Trans {...msg({ id: 'library.edit-card.review-description', message: 'This review stays paused while you edit. Your review history stays intact.' })} /> : <Trans {...msg({ context: 'library.edit-card.description', message: 'Changes update this card while its review history stays intact.' })} />}
                </Dialog.Description>
              </div>
              <button
                type="button"
                aria-label={_(msg({ id: 'library.edit-card.close', message: 'Close editor' }))}
                onClick={() => closeSheet()}
                className="flex size-10 shrink-0 items-center justify-center rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-text)] transition-colors hover:border-[var(--sf-brand)] focus-visible:outline-2 focus-visible:outline-offset-2 [html[data-theme-family=crystal]_&]:crystal-chamfer-sm"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </header>

              <form id="edit-card-form" onSubmit={submit} aria-busy={writing} className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-7 md:px-[26px]">
              <fieldset disabled={writing} className="contents">
              <section data-edit-preview aria-label={_(msg({ id: 'library.edit-card.draft-preview', message: 'Draft preview' }))} className="rounded-[var(--sf-card-radius)] border border-[color-mix(in_srgb,var(--sf-brand)_35%,var(--sf-border))] bg-[var(--sf-card-bg)] p-3 shadow-[var(--sf-panel-shadow)] md:hidden [html[data-theme-family=crystal]_&]:crystal-chamfer">
                <div className="flex min-w-0 gap-3">
                  {previewCard.imageUrl ? (
                    <img src={previewCard.imageUrl} alt={`Illustration for ${previewCard.word}`} className="size-20 shrink-0 rounded-[calc(var(--sf-card-radius)*.65)] object-cover [html[data-theme-family=crystal]_&]:crystal-chamfer-sm" />
                  ) : (
                    <div aria-hidden="true" className="flex size-20 shrink-0 items-center justify-center rounded-[calc(var(--sf-card-radius)*.65)] bg-[var(--sf-surface-raised)] text-2xl font-black text-[var(--sf-brand-text)] [html[data-theme-family=crystal]_&]:crystal-chamfer-sm">{previewCard.word.slice(0, 1).toUpperCase()}</div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-[10px] font-black uppercase tracking-[.14em] text-[var(--sf-text-muted)]">{previewCard.partOfSpeech || 'Card preview'}</p>
                      {dirty && <span data-edit-dirty className={dirtyBadgeClass}><Trans {...msg({ context: 'library.edit-card.unsaved-badge', message: 'Unsaved' })} /></span>}
                    </div>
                    <h3 data-preview-word lang={targetLanguage} className="mt-1 truncate font-serif text-2xl font-bold leading-none text-[var(--sf-text)] [html[data-theme-family=crystal]_&]:font-display [html[data-theme-family=crystal]_&]:font-black [html[data-theme-family=crystal]_&]:italic">{previewCard.word}</h3>
                    <p data-preview-phonetic lang={targetLanguage} className="mt-1 truncate font-mono text-xs text-[var(--sf-text-muted)]">{previewCard.phonetic || '—'}</p>
                    <p data-preview-translation lang={nativeLanguage} className="mt-2 line-clamp-2 font-serif text-lg font-semibold text-[var(--sf-brand-text)] [html[data-theme-family=crystal]_&]:font-display [html[data-theme-family=crystal]_&]:font-black [html[data-theme-family=crystal]_&]:italic">{previewCard.translation || '—'}</p>
                  </div>
                </div>
                {(previewCard.explanation || previewCard.exampleSentence || previewCard.mnemonic) && (
                  <div className="mt-3 grid gap-1.5 border-t border-[var(--sf-border)] pt-2 text-xs leading-5 text-[var(--sf-text-muted)]">
                    {previewCard.explanation && <p data-preview-explanation className="line-clamp-2">{previewCard.explanation}</p>}
                    {previewCard.exampleSentence && <p data-preview-example className="line-clamp-2 italic">“{previewCard.exampleSentence}”</p>}
                    {previewCard.mnemonic && <p data-preview-mnemonic className="line-clamp-2 text-[var(--sf-reward)]">💡 {previewCard.mnemonic}</p>}
                  </div>
                )}
              </section>

              <section className="mt-4 grid gap-3" aria-label={_(msg({ id: 'library.edit-card.card-fields', message: 'Card fields' }))}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="min-w-0">
                    <span className={fieldLabelClass}><Trans {...msg({ id: 'library.edit-card.word', message: 'Word' })} /></span>
                    {canRenameWord ? (
                      <div className="mt-1.5 flex min-w-0 gap-1.5">
                        <input
                          data-edit-word-input
                          aria-label={_(msg({ id: 'library.edit-card.word', message: 'Word' }))}
                          value={wordDraft}
                          lang={targetLanguage}
                          dir="auto"
                          maxLength={MAX_HEADWORD_LENGTH}
                          disabled={writing}
                          onChange={event => {
                            setWordDraft(event.target.value);
                            setWordError(null);
                          }}
                          onKeyDown={event => {
                            if (event.key !== 'Enter') return;
                            event.preventDefault();
                            void saveWord();
                          }}
                          className="min-h-11 min-w-0 flex-1 rounded-[var(--sf-card-radius)] border border-[var(--sf-border)] bg-[var(--sf-surface-control)] px-4 font-serif text-lg font-bold text-[var(--sf-text)] outline-none focus-visible:border-[var(--sf-brand)] focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--sf-brand)_24%,transparent)] [html[data-theme-family=crystal]_&]:crystal-chamfer-sm"
                        />
                        <button
                          type="button"
                          data-edit-word-save
                          aria-label={_(msg({ id: 'library.edit-card.save-word', message: 'Save word' }))}
                          disabled={writing || !wordDraft.trim() || wordDraft.trim() === openedCard.word}
                          onClick={() => saveWord()}
                          className="flex size-11 shrink-0 items-center justify-center rounded-[var(--sf-card-radius)] border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-text)] transition-colors hover:border-[var(--sf-brand)] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [html[data-theme-family=crystal]_&]:crystal-chamfer-sm"
                        >
                          {renamingWord ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
                        </button>
                      </div>
                    ) : (
                      <span lang={targetLanguage} className="mt-1.5 flex min-h-11 items-center rounded-[var(--sf-card-radius)] border border-[var(--sf-border)] bg-[var(--sf-surface-control)] px-4 font-serif text-lg font-bold text-[var(--sf-text)] [html[data-theme-family=crystal]_&]:crystal-chamfer-sm">{openedCard.word}</span>
                    )}
                    {wordErrorMessage && <p role="alert" className="mt-1.5 text-xs font-semibold text-[var(--sf-danger)]">{wordErrorMessage}</p>}
                  </div>
                  <div className="min-w-0">
                    <span className={fieldLabelClass}><Trans {...msg({ id: 'library.edit-card.part-of-speech', message: 'Part of speech' })} /></span>
                    {canEditPartOfSpeech(openedCard) ? (
                      <input
                        data-edit-partofspeech-input
                        aria-label={_(msg({ id: 'library.edit-card.part-of-speech', message: 'Part of speech' }))}
                        value={draft.partOfSpeech}
                        maxLength={MAX_PART_OF_SPEECH_LENGTH}
                        onChange={event => {
                          setDraft(previous => ({ ...previous, partOfSpeech: event.target.value }));
                          setError(null);
                        }}
                        className={textInputClass}
                      />
                    ) : (
                      <>
                        <span aria-disabled="true" className="mt-1.5 flex min-h-11 items-center rounded-[var(--sf-card-radius)] border border-[var(--sf-border)] bg-[var(--sf-surface-control)] px-4 text-sm text-[var(--sf-text-muted)] [html[data-theme-family=crystal]_&]:crystal-chamfer-sm">{openedCard.partOfSpeech || '—'}</span>
                        <p className="mt-1 text-[11px] text-[var(--sf-text-muted)]"><Trans {...msg({ context: 'library.edit-card.part-of-speech-locked', message: 'Locked to this card\'s published sense.' })} /></p>
                      </>
                    )}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block min-w-0 sm:col-span-2">
                    <span className={fieldLabelClass}><Trans {...msg({ context: 'library.edit-card.category', message: 'Category' })} /></span>
                    <input
                      data-edit-category-input
                      value={draft.category}
                      maxLength={MAX_CATEGORY_LENGTH}
                      onChange={event => {
                        setDraft(previous => ({ ...previous, category: event.target.value }));
                        setError(null);
                      }}
                      className={textInputClass}
                    />
                  </label>
                  <div className="min-w-0 sm:col-span-2">
                    <span className={fieldLabelClass}><Trans {...msg({ context: 'library.edit-card.image', message: 'Image' })} /></span>
                    <div className="mt-1.5 flex min-w-0 items-center gap-2">
                      {draft.imageUrl ? (
                        <img src={getDisplayImageUrl(draft.imageUrl)} alt="" className="size-11 shrink-0 rounded-[calc(var(--sf-card-radius)*.65)] object-cover [html[data-theme-family=crystal]_&]:crystal-chamfer-sm" />
                      ) : (
                        <div aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-[calc(var(--sf-card-radius)*.65)] border border-dashed border-[var(--sf-border)] text-[10px] font-black uppercase text-[var(--sf-text-muted)] [html[data-theme-family=crystal]_&]:crystal-chamfer-sm"><ImageOff size={16} /></div>
                      )}
                      <button
                        type="button"
                        data-edit-image-find
                        disabled={imageSearching || !cardEditCloudAvailable}
                        onClick={findAnotherPhoto}
                        className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-[var(--sf-card-radius)] border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-3 text-xs font-bold text-[var(--sf-text)] transition-colors hover:border-[var(--sf-brand)] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [html[data-theme-family=crystal]_&]:crystal-chamfer-sm"
                      >
                        {imageSearching && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                        <Trans {...msg({ context: 'library.edit-card.find-another-photo', message: 'Find another photo' })} />
                      </button>
                      {draft.imageUrl && (
                        <button
                          type="button"
                          data-edit-image-remove
                          onClick={removeImage}
                          aria-label={_(msg({ id: 'library.edit-card.remove-image', message: 'Remove image' }))}
                          className="flex size-11 shrink-0 items-center justify-center rounded-[var(--sf-card-radius)] border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-text)] transition-colors hover:border-[var(--sf-danger)] focus-visible:outline-2 focus-visible:outline-offset-2 [html[data-theme-family=crystal]_&]:crystal-chamfer-sm"
                        >
                          <X size={14} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                    {imageSearchFailed && <p role="alert" className="mt-1.5 text-xs font-semibold text-[var(--sf-danger)]">{imageSearchFailedMessage}</p>}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  {EDIT_CARD_FIELDS.map(({ key, maxLength }) => {
                    const isFullWidth = key !== 'phonetic';
                    const fieldLanguage = isNativeField(key) ? nativeLanguage : targetLanguage;
                    return (
                      <label key={key} className={`block min-w-0 ${isFullWidth ? 'sm:col-span-2' : ''}`}>
                        <span className={`block text-xs font-black uppercase tracking-[.12em] ${key === 'mnemonic' ? 'text-[var(--sf-reward)]' : 'text-[var(--sf-text-muted)]'}`}>{fieldLabels[key] ? _(fieldLabels[key]) : 'IPA'}</span>
                        <textarea
                          ref={key === 'translation' ? firstFieldRef : undefined}
                          value={draft[key]}
                          lang={fieldLanguage}
                          dir="auto"
                          maxLength={maxLength}
                          rows={fieldRows(key)}
                          onChange={event => {
                            setDraft(previous => ({ ...previous, [key]: event.target.value }));
                            setError(null);
                          }}
                          className={fieldClasses(key)}
                        />
                      </label>
                    );
                  })}
                </div>

                <p data-edit-contract-note className={noteClass}>
                  <Trans {...msg({ context: 'library.edit-card.contract-note', message: 'A published sense\'s part of speech, deck, bookmark, tags and difficulty stay unchanged in this sheet until their data contracts are available.' })} />
                </p>
                {openedCard.source && (openedCard.source.url || openedCard.source.title) && (
                  <p data-edit-source-note className={noteClass}>
                    <span className="font-black uppercase tracking-[.12em]"><Trans {...msg({ context: 'library.edit-card.source-label', message: 'Captured from' })} /></span>{' '}
                    {isDisplayableSourceUrl(openedCard.source.url) ? (
                      <a
                        href={openedCard.source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-[var(--sf-brand-text)] underline-offset-4 hover:underline"
                      >
                        {openedCard.source.title || openedCard.source.url}
                      </a>
                    ) : (
                      <span>{openedCard.source.title}</span>
                    )}
                  </p>
                )}
                <p className="flex gap-2 rounded-[var(--sf-card-radius)] border border-[color-mix(in_srgb,var(--sf-success)_45%,var(--sf-border))] bg-[color-mix(in_srgb,var(--sf-success)_10%,var(--sf-surface))] px-4 py-3 text-sm leading-6 text-[var(--sf-text)] [html[data-theme-family=crystal]_&]:crystal-chamfer-sm">
                  <Check size={16} className="mt-1 shrink-0 text-[var(--sf-success)]" aria-hidden="true" />
                  <span><Trans {...msg({ context: 'library.edit-card.history-note', message: 'Your review history is kept. Changes appear on this card right away.' })} /></span>
                </p>
                {errorMessage && <p role="alert" className="rounded-[var(--sf-card-radius)] border border-[var(--sf-danger)] bg-[color-mix(in_srgb,var(--sf-danger)_10%,var(--sf-surface))] px-4 py-3 text-sm font-semibold text-[var(--sf-danger)]">{errorMessage}</p>}
              </section>
              </fieldset>

              <footer className="sticky bottom-[-1rem] z-10 mt-5 flex flex-col-reverse gap-2 border-t border-[var(--sf-border)] bg-[var(--sf-surface)] [background-image:var(--sf-dialog-bg)] py-4 sm:flex-row sm:items-center sm:justify-end md:bottom-[-1rem]">
                {onDelete && <button type="button" data-edit-delete onClick={() => { setDeleteStatus('idle'); setConfirmation('delete'); }} disabled={writing} className="mr-auto flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-bold text-[var(--sf-danger)] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-wait disabled:opacity-60"><Trash2 size={16} aria-hidden="true" /><Trans {...msg({ id: 'library.card.delete', message: 'Delete card' })} /></button>}
                <span className="mr-auto hidden text-xs text-[var(--sf-text-muted)] sm:block"><kbd className="rounded border border-[var(--sf-border)] px-1.5 py-0.5 font-mono text-[10px]"><Trans {...msg({ context: 'library.edit-card.esc-key', message: 'Esc' })} /></kbd> <Trans {...msg({ context: 'library.edit-card.back-to-card', message: 'back to card' })} /></span>
                <button type="button" onClick={() => closeSheet()} disabled={writing} className={secondaryButtonClass}>
                  <span>{dirty ? 'Discard' : <Trans {...msg({ context: 'library.edit-card.cancel', message: 'Cancel' })} />}</span>
                </button>
                <button type="submit" disabled={writing} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--sf-brand)] px-5 text-sm font-bold text-[var(--sf-on-brand)] shadow-md transition-colors hover:bg-[var(--sf-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-wait disabled:opacity-60 [html[data-theme-family=crystal]_&]:crystal-chamfer-sm">
                  {saving && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
                  <span>{saving ? <Trans {...msg({ context: 'library.edit-card.saving', message: 'Saving changes…' })} /> : error === 'save-failed' ? 'Retry save' : context ? <Trans {...msg({ id: 'library.edit-card.save-resume', message: 'Save & resume' })} /> : <Trans {...msg({ context: 'library.edit-card.save', message: 'Save changes' })} />}</span>
                  {!saving && <kbd className="hidden rounded bg-black/15 px-1.5 py-0.5 font-mono text-[10px] sm:inline">⌘↵</kbd>}
                </button>
              </footer>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <AlertDialog.Root open={confirmation !== null} onOpenChange={nextOpen => { if (!nextOpen && !deleting) setConfirmation(null); }}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-[110] bg-slate-950/55 backdrop-blur-sm" />
          <AlertDialog.Content className="fixed left-1/2 top-1/2 z-[111] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-[var(--sf-card-radius)] border border-[var(--sf-border)] bg-[var(--sf-surface)] [background-image:var(--sf-dialog-bg)] p-6 text-[var(--sf-text)] shadow-2xl outline-none [html[data-theme-family=crystal]_&]:crystal-chamfer">
            <AlertDialog.Title className="font-serif text-2xl font-bold [html[data-theme-family=crystal]_&]:font-display [html[data-theme-family=crystal]_&]:italic">{confirmation === 'delete' ? <Trans {...msg({ context: 'library.delete.title', message: 'Delete card?' })} /> : <Trans {...msg({ context: 'library.edit-card.discard-title', message: 'Discard unsaved changes?' })} />}</AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm leading-6 text-[var(--sf-text-muted)]">
              {confirmation === 'delete' ? <><Trans {...msg({ context: 'library.delete.description', message: 'This will permanently remove {word} from your library.' })} values={{ word: openedCard.word }} /> {dirty && <Trans {...msg({ context: 'library.edit-card.discard-description', message: 'Your remaining draft will be removed.' })} />}</> : <Trans {...msg({ context: 'library.edit-card.discard-description', message: 'Your remaining draft will be removed.' })} />}
            </AlertDialog.Description>
            {confirmation === 'delete' && deleteStatus === 'failure' && <p role="alert" className="mt-3 text-sm font-semibold text-[var(--sf-danger)]"><Trans {...msg({ context: 'library.edit-card.delete-failed', message: 'This card could not be deleted. Try again.' })} /></p>}
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <AlertDialog.Cancel asChild>
                <button type="button" disabled={deleting} className={secondaryButtonClass}>{confirmation === 'delete' ? <Trans {...msg({ context: 'common.cancel', message: 'Cancel' })} /> : <Trans {...msg({ context: 'library.edit-card.keep-editing', message: 'Keep editing' })} />}</button>
              </AlertDialog.Cancel>
              <button type="button" data-edit-delete-confirm={confirmation === 'delete' || undefined} onClick={confirmation === 'delete' ? deleteCard : () => closeSheet(true)} disabled={deleting} className={dangerButtonClass}>
                {deleting && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
                <span>{confirmation === 'delete' ? deleting ? <Trans {...msg({ context: 'library.edit-card.deleting', message: 'Deleting card…' })} /> : deleteStatus === 'failure' ? <Trans {...msg({ context: 'library.edit-card.retry-delete', message: 'Retry delete' })} /> : <Trans {...msg({ context: 'library.delete.confirm', message: 'Delete card' })} /> : <Trans {...msg({ context: 'library.edit-card.discard-confirm', message: 'Discard changes' })} />}</span>
              </button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}
