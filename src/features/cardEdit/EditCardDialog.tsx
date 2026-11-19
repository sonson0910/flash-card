import * as AlertDialog from '@radix-ui/react-alert-dialog';
import * as Dialog from '@radix-ui/react-dialog';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { AlertTriangle, Check, ChevronDown, ImageOff, Loader2, Search, Star, Trash2, X } from 'lucide-react';
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
import { formatDate } from '../../lib/format';
import { splitStressedWord } from '../library/libraryCardFace';
import '../library/library-dialog-overlays.css';
import './edit-card-sheet.css';
import {
  canEditPartOfSpeech,
  createEditCardDraft,
  editCardPatch,
  EDIT_CARD_FIELDS,
  EditCardDraftError,
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
  /** Adds "Upload" beside the photo search when the host has a file service for the learner. */
  imageUpload?: CardImageUploader;
  /**
   * The learner's live deck list, in profile order. Without it the Deck
   * control offers only Unassigned and the card's current deck.
   */
  customDecks?: readonly string[];
}

/** Uploads a photo the learner picked and resolves with the URL to store on the card. */
export interface CardImageUploader {
  upload(file: File, onProgress: (fraction: number | null) => void): { readonly done: Promise<string>; cancel(): void };
}

type ImageUploadFailure = 'quota' | 'type' | 'failed';

export interface EditCardDialogContext {
  kind: 'review';
  current: number;
  total: number;
}

type EditCardError = 'invalid-content' | 'save-failed' | 'deck-missing';

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

const fieldMaxLength = Object.fromEntries(EDIT_CARD_FIELDS.map(({ key, maxLength }) => [key, maxLength])) as Record<EditableCardField, number>;

/** Splits the headword so the stressed syllable can carry the accent colour. */
function StressedHeadword({ word, phonetic, language }: { word: string; phonetic?: string; language: string }) {
  const parts = splitStressedWord(word, phonetic, language);
  if (!parts) return <>{word}</>;
  return <>{parts.before}<span className="edit-sheet-stress">{parts.stressed}</span>{parts.after}</>;
}

export function EditCardDialog({ card, open, onOpenChange, onSave, onDelete, context, imageUpload, customDecks }: EditCardDialogProps) {
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
  // `null` progress means the bytes are sent and the service is still confirming the photo.
  const [imageUploadProgress, setImageUploadProgress] = useState<number | null | undefined>(undefined);
  const [imageUploadFailure, setImageUploadFailure] = useState<ImageUploadFailure | null>(null);
  const imageUploadTaskRef = useRef<{ cancel(): void } | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
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
      imageUploadTaskRef.current?.cancel();
      imageUploadTaskRef.current = null;
      setImageUploadProgress(undefined);
      setImageUploadFailure(null);
    }
    if (!open) {
      imageUploadTaskRef.current?.cancel();
      imageUploadTaskRef.current = null;
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
  const patchOptions = customDecks ? { customDecks } : {};
  const errorMessage = error && _(error === 'save-failed'
    ? msg({ id: 'library.edit-card.save-failed', message: 'Your changes could not be saved. This card may have changed elsewhere. Try again.' })
    : error === 'deck-missing'
      ? msg({ id: 'library.edit-card.deck-missing', message: 'This deck no longer exists. Choose another deck.' })
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
    setImageUploadFailure(null);
  };

  const imageUploading = imageUploadProgress !== undefined;
  // The photo is resized in the browser, stored in the learner's files and put on the draft;
  // nothing reaches the card until the learner saves.
  const uploadImage = async (file: File | undefined) => {
    if (!file || !imageUpload || imageUploading || writing) return;
    setImageUploadFailure(null);
    setImageSearchFailed(false);
    setImageUploadProgress(0);
    const task = imageUpload.upload(file, fraction => setImageUploadProgress(fraction));
    imageUploadTaskRef.current = task;
    try {
      const url = await task.done;
      if (imageUploadTaskRef.current !== task) return;
      setDraft(previous => ({ ...previous, imageUrl: url, imageSearchQuery: '' }));
    } catch (failure) {
      if (imageUploadTaskRef.current !== task) return;
      const kind = (failure as { kind?: unknown } | null)?.kind;
      if (kind !== 'canceled') setImageUploadFailure(kind === 'quota' ? 'quota' : kind === 'type' || kind === 'size' ? 'type' : 'failed');
    } finally {
      if (imageUploadTaskRef.current === task) {
        imageUploadTaskRef.current = null;
        setImageUploadProgress(undefined);
      }
    }
  };

  const cancelImageUpload = () => {
    imageUploadTaskRef.current?.cancel();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (writing) return;
    let patch: Partial<CardData>;
    try {
      patch = editCardPatch(openedCard, draft, patchOptions);
    } catch (draftError) {
      setError(draftError instanceof EditCardDraftError ? draftError.reason : 'invalid-content');
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
        patch = editCardPatch(cardToSave, draft, patchOptions);
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

  const isReview = context?.kind === 'review';
  const reviewCount = openedCard.fsrs?.reps ?? openedCard.reviews;
  const addedAt = openedCard.createdAt ? new Date(openedCard.createdAt) : null;
  const cardFacts = [
    openedCard.customDeck || null,
    addedAt && !Number.isNaN(addedAt.getTime()) ? _({ ...msg({ id: 'library.edit-card.added-on', message: 'Added {date}' }), values: { date: formatDate(addedAt, { day: 'numeric', month: 'short' }) } }) : null,
    typeof reviewCount === 'number' && reviewCount > 0 ? _({ ...msg({ id: 'library.edit-card.reviewed-count', message: '{count, plural, one {Reviewed # time} other {Reviewed # times}}' }), values: { count: reviewCount } }) : null,
  ].filter((fact): fact is string => Boolean(fact));

  const updateDraft = <K extends keyof EditCardDraft>(key: K, value: EditCardDraft[K]) => {
    setDraft(previous => ({ ...previous, [key]: value }));
    setError(null);
  };

  // Profile decks in profile order. A deck the card (or the draft) names that
  // is no longer in the live list stays selectable under a note, so saving an
  // unrelated field never moves the card out of it.
  const openedDeck = openedCard.customDeck || '';
  const deckOptions = [...(customDecks ?? [])];
  const missingDecks = [openedDeck, draft.deck].filter((name, index, names) =>
    Boolean(name) && !deckOptions.includes(name) && names.indexOf(name) === index);
  const deckField = (
    <label className="edit-sheet-field edit-sheet-field--deck">
      <span className="edit-sheet-label"><Trans {...msg({ id: 'library.edit-card.deck', message: 'Deck' })} /></span>
      <span className="edit-sheet-select">
        <select
          data-edit-deck-select
          value={draft.deck}
          onChange={event => updateDraft('deck', event.target.value)}
          className="edit-sheet-input edit-sheet-select-input"
        >
          <option value="">{_(msg({ id: 'library.edit-card.deck-unassigned', message: 'Unassigned' }))}</option>
          {deckOptions.map(name => <option key={name} value={name}>{name}</option>)}
          {missingDecks.map(name => (
            <option key={`missing:${name}`} value={name}>
              {customDecks
                ? _({ ...msg({ id: 'library.edit-card.deck-not-listed', message: '{name} (not in your deck list)' }), values: { name } })
                : name}
            </option>
          ))}
        </select>
        <ChevronDown size={16} aria-hidden="true" className="edit-sheet-select-chevron" />
      </span>
    </label>
  );

  const starredToggle = (
    <button
      type="button"
      data-edit-starred
      aria-pressed={draft.starred}
      onClick={() => updateDraft('starred', !draft.starred)}
      className="edit-sheet-star"
    >
      <Star size={14} fill={draft.starred ? 'currentColor' : 'none'} aria-hidden="true" />
      <Trans {...msg({ id: 'library.edit-card.starred', message: 'Starred' })} />
    </button>
  );

  const textField = (key: Exclude<EditableCardField, 'phonetic'>, rows = 1) => (
    <label key={key} className={`edit-sheet-field edit-sheet-field--${key}`}>
      <span className="edit-sheet-label">{_(fieldLabels[key])}</span>
      <textarea
        data-edit-field={key}
        ref={key === 'translation' ? firstFieldRef : undefined}
        value={draft[key]}
        lang={isNativeField(key) ? nativeLanguage : targetLanguage}
        dir="auto"
        maxLength={fieldMaxLength[key]}
        rows={rows}
        onChange={event => updateDraft(key, event.target.value)}
        className="edit-sheet-input edit-sheet-textarea"
      />
    </label>
  );

  const phoneticInput = (inline: boolean) => (
    <input
      data-edit-field="phonetic"
      aria-label={_(msg({ id: 'library.edit-card.phonetic', message: 'IPA' }))}
      value={draft.phonetic}
      lang={targetLanguage}
      dir="ltr"
      maxLength={fieldMaxLength.phonetic}
      onChange={event => updateDraft('phonetic', event.target.value)}
      className={inline ? 'edit-sheet-word-ipa' : 'edit-sheet-input edit-sheet-input--mono'}
    />
  );

  const wordField = (
    <div className="edit-sheet-field edit-sheet-field--word">
      <span className="edit-sheet-label"><Trans {...msg({ id: 'library.edit-card.word', message: 'Word' })} /></span>
      <div className="edit-sheet-word">
        {canRenameWord ? (
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
            className="edit-sheet-word-input"
          />
        ) : (
          <span lang={targetLanguage} className="edit-sheet-word-input edit-sheet-word-input--static">{openedCard.word}</span>
        )}
        {isReview && phoneticInput(true)}
        {canRenameWord && (
          <button
            type="button"
            data-edit-word-save
            aria-label={_(msg({ id: 'library.edit-card.save-word', message: 'Save word' }))}
            disabled={writing || !wordDraft.trim() || wordDraft.trim() === openedCard.word}
            onClick={() => saveWord()}
            className="edit-sheet-word-save"
          >
            {renamingWord ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
          </button>
        )}
      </div>
      {wordErrorMessage && <p role="alert" className="edit-sheet-field-error">{wordErrorMessage}</p>}
    </div>
  );

  const partOfSpeechField = (
    <div className="edit-sheet-field edit-sheet-field--part-of-speech">
      <span className="edit-sheet-label"><Trans {...msg({ id: 'library.edit-card.part-of-speech', message: 'Part of speech' })} /></span>
      {canEditPartOfSpeech(openedCard) ? (
        <input
          data-edit-partofspeech-input
          aria-label={_(msg({ id: 'library.edit-card.part-of-speech', message: 'Part of speech' }))}
          value={draft.partOfSpeech}
          maxLength={MAX_PART_OF_SPEECH_LENGTH}
          onChange={event => updateDraft('partOfSpeech', event.target.value)}
          className="edit-sheet-input"
        />
      ) : (
        <>
          <span aria-disabled="true" className="edit-sheet-input edit-sheet-input--locked">{openedCard.partOfSpeech || '—'}</span>
          <p className="edit-sheet-hint"><Trans {...msg({ context: 'library.edit-card.part-of-speech-locked', message: 'Locked to this card\'s published sense.' })} /></p>
        </>
      )}
    </div>
  );

  const categoryField = (
    <label className="edit-sheet-field edit-sheet-field--category">
      <span className="edit-sheet-label"><Trans {...msg({ context: 'library.edit-card.category', message: 'Category' })} /></span>
      <input
        data-edit-category-input
        value={draft.category}
        maxLength={MAX_CATEGORY_LENGTH}
        onChange={event => updateDraft('category', event.target.value)}
        className="edit-sheet-input"
      />
    </label>
  );

  const imageField = (
    <div className="edit-sheet-field edit-sheet-field--image">
      <span className="edit-sheet-label"><Trans {...msg({ context: 'library.edit-card.image', message: 'Image' })} /></span>
      <div className="edit-sheet-image">
        {draft.imageUrl ? (
          <img src={getDisplayImageUrl(draft.imageUrl)} alt="" className="edit-sheet-image-thumb" />
        ) : (
          <div aria-hidden="true" className="edit-sheet-image-thumb edit-sheet-image-thumb--empty"><ImageOff size={18} /></div>
        )}
        <div className="edit-sheet-image-actions">
          <button
            type="button"
            data-edit-image-find
            disabled={imageSearching || imageUploading || !cardEditCloudAvailable}
            onClick={findAnotherPhoto}
            className="edit-sheet-chip-button"
          >
            {imageSearching ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Search size={14} aria-hidden="true" />}
            <Trans {...msg({ context: 'library.edit-card.find-another-photo', message: 'Find another photo' })} />
          </button>
          {imageUpload ? (
            <div className="edit-sheet-image-links">
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                tabIndex={-1}
                className="edit-sheet-image-input"
                aria-label={_(msg({ id: 'library.edit-card.upload-image-input', message: 'Upload a photo' }))}
                onChange={event => {
                  void uploadImage(event.currentTarget.files?.[0]);
                  event.currentTarget.value = '';
                }}
              />
              {imageUploading ? (
                <button type="button" data-edit-image-upload-cancel onClick={cancelImageUpload} className="edit-sheet-link-button">
                  <Trans {...msg({ id: 'library.edit-card.upload-image-cancel', message: 'Cancel upload' })} />
                </button>
              ) : (
                <button
                  type="button"
                  data-edit-image-upload
                  disabled={imageSearching || writing}
                  onClick={() => imageInputRef.current?.click()}
                  aria-label={_(msg({ id: 'library.edit-card.upload-image', message: 'Upload a photo from this device' }))}
                  className="edit-sheet-link-button"
                >
                  <Trans {...msg({ id: 'library.edit-card.upload-image-short', message: 'Upload' })} />
                </button>
              )}
              {draft.imageUrl && !imageUploading && (
                <>
                  <span aria-hidden="true" className="edit-sheet-image-links-dot">·</span>
                  <button
                    type="button"
                    data-edit-image-remove
                    onClick={removeImage}
                    aria-label={_(msg({ id: 'library.edit-card.remove-image', message: 'Remove image' }))}
                    className="edit-sheet-link-button"
                  >
                    <Trans {...msg({ context: 'library.edit-card.remove-image-short', message: 'Remove' })} />
                  </button>
                </>
              )}
            </div>
          ) : draft.imageUrl && (
            <button
              type="button"
              data-edit-image-remove
              onClick={removeImage}
              aria-label={_(msg({ id: 'library.edit-card.remove-image', message: 'Remove image' }))}
              className="edit-sheet-link-button"
            >
              <Trans {...msg({ context: 'library.edit-card.remove-image-short', message: 'Remove' })} />
            </button>
          )}
        </div>
      </div>
      {imageUploading && (
        <p role="status" className="edit-sheet-image-progress">
          {imageUploadProgress === null
            ? <Trans {...msg({ id: 'library.edit-card.upload-image-checking', message: 'Checking the photo…' })} />
            : <Trans {...msg({ id: 'library.edit-card.upload-image-progress', message: 'Uploading photo… {percent}%' })} values={{ percent: Math.round((imageUploadProgress ?? 0) * 100) }} />}
        </p>
      )}
      {imageSearchFailed && <p role="alert" className="edit-sheet-field-error">{imageSearchFailedMessage}</p>}
      {imageUploadFailure === 'quota' && <p role="alert" className="edit-sheet-field-error"><Trans {...msg({ id: 'library.edit-card.upload-image-quota', message: 'Your storage is full. Delete files you no longer need, then try again.' })} /></p>}
      {imageUploadFailure === 'type' && <p role="alert" className="edit-sheet-field-error"><Trans {...msg({ id: 'library.edit-card.upload-image-type', message: 'Choose a PNG, JPEG, or WebP photo within your plan’s size limit.' })} /></p>}
      {imageUploadFailure === 'failed' && <p role="alert" className="edit-sheet-field-error"><Trans {...msg({ id: 'library.edit-card.upload-image-failed', message: 'The photo could not be uploaded. Try again.' })} /></p>}
    </div>
  );

  const deleteButton = onDelete && (
    <button type="button" data-edit-delete onClick={() => { setDeleteStatus('idle'); setConfirmation('delete'); }} disabled={writing} className="edit-sheet-delete">
      <Trash2 size={16} aria-hidden="true" />
      <Trans {...msg({ id: 'library.card.delete', message: 'Delete card' })} />
    </button>
  );

  const sourceNote = openedCard.source && (openedCard.source.url || openedCard.source.title) && (
    <p data-edit-source-note className="edit-sheet-note">
      <span className="edit-sheet-note-label"><Trans {...msg({ context: 'library.edit-card.source-label', message: 'Captured from' })} /></span>{' '}
      {isDisplayableSourceUrl(openedCard.source.url) ? (
        <a href={openedCard.source.url} target="_blank" rel="noopener noreferrer">
          {openedCard.source.title || openedCard.source.url}
        </a>
      ) : (
        <span>{openedCard.source.title}</span>
      )}
    </p>
  );

  return (
    <>
      <Dialog.Root open={open} onOpenChange={handleDialogOpenChange}>
        <Dialog.Portal>
          {isReview && (
            <div data-edit-preview-backdrop aria-hidden="true" className="edit-sheet-backdrop">
              <div className="edit-sheet-preview-card">
                {previewCard.imageUrl ? <img src={previewCard.imageUrl} alt="" className="edit-sheet-preview-image" /> : <div className="edit-sheet-preview-image edit-sheet-preview-image--letter">{previewCard.word.slice(0, 1).toUpperCase()}</div>}
                <div className="edit-sheet-preview-body">
                  <p className="edit-sheet-preview-kicker">{previewCard.partOfSpeech || _(msg({ id: 'library.edit-card.preview-fallback', message: 'Card preview' }))} <Trans {...msg({ context: 'library.edit-card.editing-badge', message: '· editing' })} /></p>
                  <p lang={targetLanguage} className="edit-sheet-preview-word"><StressedHeadword word={previewCard.word} phonetic={previewCard.phonetic} language={targetLanguage} /></p>
                  <p className="edit-sheet-preview-ipa">{previewCard.phonetic || '—'}</p>
                  <div className="edit-sheet-preview-meaning">
                    <p lang={nativeLanguage}>{previewCard.translation || '—'}</p>
                    {dirty && <span className="edit-sheet-dirty"><Trans {...msg({ context: 'library.edit-card.unsaved-badge', message: 'Unsaved' })} /></span>}
                  </div>
                </div>
              </div>
            </div>
          )}
          <Dialog.Overlay data-edit-overlay className={`edit-sheet-overlay${isReview ? ' edit-sheet-overlay--review' : ''}`} />
          <Dialog.Content
            data-card-edit-sheet
            onOpenAutoFocus={event => {
              event.preventDefault();
              firstFieldRef.current?.focus();
            }}
            className={`edit-sheet ${isReview ? 'edit-sheet--review' : 'edit-sheet--dialog'}`}
          >
            <div aria-hidden="true" className="edit-sheet-grabber" />
            <header className="edit-sheet-header">
              <div className="edit-sheet-heading">
                <p className="edit-sheet-kicker">
                  {context ? <Trans {...msg({ id: 'library.edit-card.review-kicker', message: 'Card {current} of {total}' })} values={{ current: context.current, total: context.total }} /> : cardFacts.length ? cardFacts.join(' · ') : <Trans {...msg({ context: 'library.edit-card.kicker', message: 'Card editor' })} />}
                </p>
                <Dialog.Title className="edit-sheet-title">
                  <Trans {...msg({ context: 'library.edit-card.title', message: 'Edit card' })} />
                </Dialog.Title>
                <Dialog.Description className="sr-only">
                  {context ? <Trans {...msg({ id: 'library.edit-card.review-description', message: 'This review stays paused while you edit. Your review history stays intact.' })} /> : <Trans {...msg({ context: 'library.edit-card.description', message: 'Changes update this card while its review history stays intact.' })} />}
                </Dialog.Description>
              </div>
              <button
                type="button"
                aria-label={_(msg({ id: 'library.edit-card.close', message: 'Close editor' }))}
                onClick={() => closeSheet()}
                className="edit-sheet-close"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </header>

            <form id="edit-card-form" onSubmit={submit} aria-busy={writing} className="edit-sheet-form">
              <div className="edit-sheet-scroll">
              <fieldset disabled={writing} className="contents">
              <section data-edit-preview aria-label={_(msg({ id: 'library.edit-card.draft-preview', message: 'Draft preview' }))} className="edit-sheet-mobile-preview md:hidden">
                {previewCard.imageUrl ? (
                  <img src={previewCard.imageUrl} alt={`Illustration for ${previewCard.word}`} className="edit-sheet-mobile-preview-image" />
                ) : (
                  <div aria-hidden="true" className="edit-sheet-mobile-preview-image edit-sheet-mobile-preview-image--letter">{previewCard.word.slice(0, 1).toUpperCase()}</div>
                )}
                <div className="edit-sheet-mobile-preview-body">
                  <div className="edit-sheet-mobile-preview-top">
                    <p className="edit-sheet-preview-kicker">{previewCard.partOfSpeech || _(msg({ id: 'library.edit-card.preview-fallback', message: 'Card preview' }))}</p>
                    {dirty && <span data-edit-dirty className="edit-sheet-dirty"><Trans {...msg({ context: 'library.edit-card.unsaved-badge', message: 'Unsaved' })} /></span>}
                  </div>
                  <h3 data-preview-word lang={targetLanguage} className="edit-sheet-mobile-preview-word"><StressedHeadword word={previewCard.word} phonetic={previewCard.phonetic} language={targetLanguage} /></h3>
                  <p data-preview-phonetic lang={targetLanguage} className="edit-sheet-preview-ipa">{previewCard.phonetic || '—'}</p>
                  <p data-preview-translation lang={nativeLanguage} className="edit-sheet-mobile-preview-meaning">{previewCard.translation || '—'}</p>
                </div>
              </section>

              <section className="edit-sheet-fields" aria-label={_(msg({ id: 'library.edit-card.card-fields', message: 'Card fields' }))}>
                {isReview ? (
                  <>
                    {wordField}
                    {textField('translation', 3)}
                    {textField('exampleSentence')}
                    {imageField}
                    {deckField}
                    <div className="edit-sheet-pair">
                      {categoryField}
                      {partOfSpeechField}
                    </div>
                    <div className="edit-sheet-flags">
                      {starredToggle}
                    </div>
                    <details className="edit-sheet-more">
                      <summary><Trans {...msg({ context: 'library.edit-card.more-fields', message: 'Definition, translations and memory hook' })} /></summary>
                      <div className="edit-sheet-more-fields">
                        {textField('explanation', 2)}
                        {textField('explanationTranslation', 2)}
                        {textField('exampleTranslation')}
                        {textField('mnemonic', 2)}
                      </div>
                    </details>
                  </>
                ) : (
                  <div className="edit-sheet-grid">
                    {wordField}
                    {partOfSpeechField}
                    {textField('translation')}
                    <label className="edit-sheet-field edit-sheet-field--phonetic">
                      <span className="edit-sheet-label">{_(msg({ id: 'library.edit-card.phonetic', message: 'IPA' }))}</span>
                      {phoneticInput(false)}
                    </label>
                    {textField('explanation')}
                    {textField('explanationTranslation')}
                    {textField('exampleSentence')}
                    {textField('exampleTranslation')}
                    {textField('mnemonic', 2)}
                    {imageField}
                    {deckField}
                    {categoryField}
                    <div className="edit-sheet-flags">
                      {starredToggle}
                    </div>
                  </div>
                )}
                {sourceNote}
                <p className="edit-sheet-history">
                  <Check size={16} aria-hidden="true" />
                  <span><Trans {...msg({ context: 'library.edit-card.history-note', message: 'Your review history is kept. Changes appear on this card right away.' })} /></span>
                </p>
                {errorMessage && <p role="alert" className="edit-sheet-error">{errorMessage}</p>}
                {isReview && deleteButton}
              </section>
              </fieldset>
              </div>

              <footer className="edit-sheet-footer">
                {!isReview && deleteButton}
                {isReview && <span className="edit-sheet-esc"><kbd><Trans {...msg({ context: 'library.edit-card.esc-key', message: 'Esc' })} /></kbd> <Trans {...msg({ context: 'library.edit-card.back-to-card', message: 'back to card' })} /></span>}
                <button type="button" onClick={() => closeSheet()} disabled={writing} className="edit-sheet-button">
                  <span>{dirty ? <Trans {...msg({ context: 'library.edit-card.discard', message: 'Discard' })} /> : <Trans {...msg({ context: 'library.edit-card.cancel', message: 'Cancel' })} />}</span>
                </button>
                <button type="submit" disabled={writing} className="edit-sheet-button edit-sheet-button--primary">
                  {saving && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
                  <span>{saving ? <Trans {...msg({ context: 'library.edit-card.saving', message: 'Saving changes…' })} /> : error === 'save-failed' ? <Trans {...msg({ context: 'library.edit-card.retry-save', message: 'Retry save' })} /> : context ? <Trans {...msg({ id: 'library.edit-card.save-resume', message: 'Save & resume' })} /> : <Trans {...msg({ context: 'library.edit-card.save', message: 'Save changes' })} />}</span>
                  {isReview && !saving && <kbd aria-hidden="true">⌘↵</kbd>}
                </button>
              </footer>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <AlertDialog.Root open={confirmation !== null} onOpenChange={nextOpen => { if (!nextOpen && !deleting) setConfirmation(null); }}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="library-dialog-overlay library-dialog-overlay--danger edit-sheet-confirm-overlay" />
          <AlertDialog.Content className="library-dialog-frame library-dialog-frame--danger edit-sheet-confirm">
            <div className="library-dialog-header">
              <div className="library-dialog-heading-with-icon">
                <span className="library-dialog-danger-icon" aria-hidden="true">{confirmation === 'delete' ? <Trash2 size={22} /> : <AlertTriangle size={22} />}</span>
                <div>
                  <AlertDialog.Title className="library-dialog-title">{confirmation === 'delete' ? <Trans {...msg({ context: 'library.delete.title', message: 'Delete card?' })} /> : <Trans {...msg({ context: 'library.edit-card.discard-title', message: 'Discard unsaved changes?' })} />}</AlertDialog.Title>
                </div>
              </div>
            </div>
            <div className="library-dialog-body">
              <AlertDialog.Description className="library-dialog-description library-dialog-description--body">
                {confirmation === 'delete' ? <><Trans {...msg({ context: 'library.delete.description', message: 'This will permanently remove {word} from your library.' })} values={{ word: openedCard.word }} /> {dirty && <Trans {...msg({ context: 'library.edit-card.discard-description', message: 'Your remaining draft will be removed.' })} />}</> : <Trans {...msg({ context: 'library.edit-card.discard-description', message: 'Your remaining draft will be removed.' })} />}
              </AlertDialog.Description>
              {confirmation === 'delete' && deleteStatus === 'failure' && <p role="alert" className="library-dialog-error"><Trans {...msg({ context: 'library.edit-card.delete-failed', message: 'This card could not be deleted. Try again.' })} /></p>}
            </div>
            <div className="library-dialog-footer">
              <span aria-hidden="true" />
              <AlertDialog.Cancel asChild>
                <button type="button" disabled={deleting} className="library-dialog-button library-dialog-button--secondary">{confirmation === 'delete' ? <Trans {...msg({ context: 'common.cancel', message: 'Cancel' })} /> : <Trans {...msg({ context: 'library.edit-card.keep-editing', message: 'Keep editing' })} />}</button>
              </AlertDialog.Cancel>
              <button type="button" data-edit-delete-confirm={confirmation === 'delete' || undefined} onClick={confirmation === 'delete' ? deleteCard : () => closeSheet(true)} disabled={deleting} aria-busy={deleting} className="library-dialog-button library-dialog-button--danger">
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
