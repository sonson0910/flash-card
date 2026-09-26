import * as Dialog from '@radix-ui/react-dialog';
import { i18n, type MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Trans } from '@lingui/react';
import { AlertCircle, Check, Loader2, RefreshCw, Sparkles, Volume2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { playWordAudio, type WordAudioPlayback } from '../../lib/audio';
import type { CardData } from '../../types/card';
import type {
  CardCreatorActions,
  CardCreatorDraft,
  CardCreatorModel,
  CardGenerationField,
  ManualCardDraft,
} from './card-creator-model';
import './create-card-dialog.css';

export interface CreateCardDeckOption {
  value: string;
  label?: string;
  allowed?: boolean;
  disabled?: boolean;
  reason?: string;
}

export interface CreateCardDialogProps {
  model: CardCreatorModel;
  actions: CardCreatorActions;
  deckOptions: readonly (string | CreateCardDeckOption)[];
  allowUnassigned?: boolean;
}

const translate = (descriptor: MessageDescriptor, values?: Record<string, unknown>): string =>
  i18n.locale ? i18n._(values ? { ...descriptor, values } : descriptor) : descriptor.message ?? descriptor.id;

const CREATE_CARD_MESSAGES = {
  optional: msg({ id: 'library.create-card.optional', message: 'optional' }),
  word: msg({ id: 'library.create-card.word', message: 'Word or phrase' }),
  context: msg({ id: 'library.create-card.context', message: 'Context sentence' }),
  contextPlaceholder: msg({ id: 'library.create-card.context-placeholder', message: 'Add a sentence to guide the draft' }),
  partOfSpeech: msg({ id: 'library.create-card.part-of-speech', message: 'Part of speech' }),
  posAuto: msg({ id: 'library.create-card.pos.auto', message: 'Auto' }),
  posNoun: msg({ id: 'library.create-card.pos.noun', message: 'noun' }),
  posVerb: msg({ id: 'library.create-card.pos.verb', message: 'verb' }),
  posAdjective: msg({ id: 'library.create-card.pos.adjective', message: 'adjective' }),
  posAdverb: msg({ id: 'library.create-card.pos.adverb', message: 'adverb' }),
  aiKicker: msg({ id: 'library.create-card.kicker.ai', message: 'NEW CARD' }),
  manualKicker: msg({ id: 'library.create-card.kicker.manual', message: 'MANUAL CARD' }),
  title: msg({ id: 'library.create-card.title', message: 'Add a word' }),
  aiDescription: msg({ id: 'library.create-card.description.ai', message: 'SonFlash drafts the card — you decide what stays.' }),
  manualDescription: msg({ id: 'library.create-card.description.manual', message: 'Add the details you already know, then save the card.' }),
  close: msg({ id: 'library.close', message: 'Close' }),
  previewAi: msg({ id: 'library.create-card.preview.ai-draft', message: 'AI draft' }),
  previewManual: msg({ id: 'library.create-card.preview.manual-draft', message: 'Manual draft' }),
  editGenerated: msg({ id: 'library.create-card.preview.edit-generated', message: 'Edit the generated details below' }),
  editManual: msg({ id: 'library.create-card.preview.edit-manual', message: 'Edit your card details below' }),
  playPronunciation: msg({ id: 'library.create-card.audio', message: 'Play pronunciation for {word}' }),
  pronunciation: msg({ id: 'library.create-card.pronunciation', message: 'Pronunciation' }),
  pronunciationPlaceholder: msg({ id: 'library.create-card.pronunciation-placeholder', message: '/pronunciation/' }),
  cefr: msg({ id: 'library.create-card.cefr', message: 'CEFR level' }),
  cefrPlaceholder: msg({ id: 'library.create-card.cefr-placeholder', message: 'CEFR' }),
  meaning: msg({ id: 'library.create-card.meaning', message: 'Meaning' }),
  definition: msg({ id: 'library.create-card.definition', message: 'Definition' }),
  example: msg({ id: 'library.create-card.example', message: 'Example' }),
  examples: msg({ id: 'library.create-card.examples', message: 'Examples' }),
  exampleSentence: msg({ id: 'library.create-card.example-sentence', message: 'Example sentence' }),
  translation: msg({ id: 'library.create-card.translation', message: 'Translation' }),
  exampleTranslation: msg({ id: 'library.create-card.example-translation', message: 'Example translation' }),
  wordFamily: msg({ id: 'library.create-card.word-family', message: 'Word family' }),
  wordFamilyField: msg({ id: 'library.create-card.word-family-field', message: 'Word family {part}' }),
  manualDetails: msg({ id: 'library.create-card.manual-details', message: 'MANUAL DETAILS' }),
  yourCard: msg({ id: 'library.create-card.your-card', message: 'Your card' }),
  useAiDraft: msg({ id: 'library.create-card.use-ai-draft', message: 'Use AI draft' }),
  regenerateGroup: msg({ id: 'library.create-card.regenerate-group', message: 'Regenerate selected card details' }),
  regenerateSelected: msg({ id: 'library.create-card.regenerate-selected', message: 'Regenerate selected details' }),
  regenerateHint: msg({ id: 'library.create-card.regenerate-hint', message: 'Each completed generation uses one AI request' }),
  preparing: msg({ id: 'library.create-card.preparing', message: 'SonFlash is preparing your card…' }),
  emptyPreview: msg({ id: 'library.create-card.empty-preview', message: 'Your generated card preview will appear here.' }),
  saveTo: msg({ id: 'library.create-card.save-to', message: 'Save to' }),
  unassigned: msg({ id: 'library.create-card.unassigned', message: 'Unassigned' }),
  unavailable: msg({ id: 'library.create-card.unavailable', message: 'Unavailable' }),
  planLimit: msg({ id: 'library.create-card.deck-reason.plan-limit', message: 'Plan limit' }),
  readyAfterSaving: msg({ id: 'library.create-card.ready-after-saving', message: 'Ready after saving' }),
  duplicate: msg({ id: 'library.create-card.duplicate', message: 'A card for {word} already exists in your library. Choose another word or close this dialog.' }),
  addManually: msg({ id: 'library.create-card.add-manually', message: 'Add manually' }),
  requestCount: msg({ id: 'library.create-card.request-count', message: '{count, plural, one {# AI request completed} other {# AI requests completed}}' }),
  regenerate: msg({ id: 'library.create-card.regenerate', message: 'Regenerate' }),
  generating: msg({ id: 'library.create-card.generating', message: 'Generating…' }),
  regenerating: msg({ id: 'library.create-card.regenerating', message: 'Regenerating…' }),
  saving: msg({ id: 'library.create-card.saving', message: 'Saving…' }),
  saveCard: msg({ id: 'library.create-card.save', message: 'Save card' }),
  generatePreview: msg({ id: 'library.create-card.generate-preview', message: 'Generate preview' }),
  errors: {
    quota: msg({ id: 'library.create-card.error.quota', message: 'Your AI card allowance is used up. Add this card manually or try again when it resets.' }),
    unavailable: msg({ id: 'library.create-card.error.unavailable', message: 'The AI service is unavailable. Your word is still here; try again.' }),
    authentication: msg({ id: 'library.create-card.error.authentication', message: 'Sign in again to create an AI card. Your word is still here.' }),
    permission: msg({ id: 'library.create-card.error.permission', message: 'The AI service rejected this request. Sign in again and try once more.' }),
    configuration: msg({ id: 'library.create-card.error.configuration', message: 'The AI service is not ready for this app. Try again later.' }),
    timeout: msg({ id: 'library.create-card.error.timeout', message: 'The AI service took too long to respond. Your word is still here; try again.' }),
    invalid: msg({ id: 'library.create-card.error.invalid', message: 'Check the card details and try again.' }),
    generation: msg({ id: 'library.create-card.error.generation', message: 'The AI service could not create this card. Your word is still here; try again.' }),
    save: msg({ id: 'library.create-card.error.save', message: 'The card could not be saved. Your draft is still here; try again.' }),
    duplicateError: msg({ id: 'library.create-card.error.duplicate', message: 'This card is already in your library.' }),
    deckUnavailable: msg({ id: 'library.create-card.error.deck-unavailable', message: 'Deck “{deck}” is no longer available. Choose another deck and try again.' }),
    default: msg({ id: 'library.create-card.error.default', message: 'The card could not be created. Your word is still here; try again.' }),
    emptyWord: msg({ id: 'library.create-card.error.empty-word', message: 'Enter a word or phrase to create a card.' }),
    generateDeck: msg({ id: 'library.create-card.error.generate-deck', message: 'Choose an available deck before generating the card.' }),
    manualFields: msg({ id: 'library.create-card.error.manual-fields', message: 'Enter a word and meaning before saving the manual card.' }),
    manualDeck: msg({ id: 'library.create-card.error.manual-deck', message: 'Choose an available deck before saving the card.' }),
    regenerateSelection: msg({ id: 'library.create-card.error.regenerate-selection', message: 'Choose at least one detail to regenerate.' }),
  },
} as const;

const WORD_FAMILY_MESSAGES = {
  noun: msg({ id: 'library.create-card.word-family.noun', message: 'noun' }),
  verb: msg({ id: 'library.create-card.word-family.verb', message: 'verb' }),
  adj: msg({ id: 'library.create-card.word-family.adjective', message: 'adjective' }),
  adv: msg({ id: 'library.create-card.word-family.adverb', message: 'adverb' }),
} as const;

const POS_OPTIONS = [
  { value: '', label: CREATE_CARD_MESSAGES.posAuto },
  { value: 'noun', label: CREATE_CARD_MESSAGES.posNoun },
  { value: 'verb', label: CREATE_CARD_MESSAGES.posVerb },
  { value: 'adjective', label: CREATE_CARD_MESSAGES.posAdjective },
  { value: 'adverb', label: CREATE_CARD_MESSAGES.posAdverb },
] as const;

const REGENERABLE_FIELDS: ReadonlyArray<{ value: CardGenerationField; label: MessageDescriptor }> = [
  { value: 'meaning', label: CREATE_CARD_MESSAGES.meaning },
  { value: 'pronunciation', label: CREATE_CARD_MESSAGES.pronunciation },
  { value: 'examples', label: CREATE_CARD_MESSAGES.examples },
  { value: 'wordFamily', label: CREATE_CARD_MESSAGES.wordFamily },
  { value: 'cefr', label: CREATE_CARD_MESSAGES.cefr },
];

const ALL_REGENERABLE_FIELDS = REGENERABLE_FIELDS.map(field => field.value);

const MANUAL_DEFAULTS: Omit<ManualCardDraft, 'word' | 'deck' | 'partOfSpeech'> = {
  translation: '',
  explanation: '',
  phonetic: '',
  exampleSentence: '',
  exampleTranslation: '',
};

const deckOption = (value: string | CreateCardDeckOption): CreateCardDeckOption =>
  typeof value === 'string' ? { value, label: value } : value;

const normalizedDeckOptions = (
  options: readonly (string | CreateCardDeckOption)[],
  selected: string,
): CreateCardDeckOption[] => {
  const seen = new Set<string>();
  const normalized = options.map(deckOption).filter(option => {
    const value = option.value.trim();
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
  if (selected && !seen.has(selected)) {
    normalized.push({ value: selected, label: selected, allowed: false, disabled: true, reason: translate(CREATE_CARD_MESSAGES.unavailable) });
  }
  return normalized;
};

const isAllowedDeck = (option: CreateCardDeckOption | undefined): boolean =>
  Boolean(option) && option?.allowed !== false && option?.disabled !== true;

const deckOptionReason = (reason: string | undefined): string => {
  const normalized = reason?.trim().toLowerCase();
  if (!normalized) return translate(CREATE_CARD_MESSAGES.unavailable);
  if (normalized === 'plan limit' || normalized.includes('plan limit')) return translate(CREATE_CARD_MESSAGES.planLimit);
  return reason?.trim() ?? translate(CREATE_CARD_MESSAGES.unavailable);
};

const readErrorField = (error: unknown, field: string): string => {
  if (!error || typeof error !== 'object' || !(field in error)) return '';
  const value = (error as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : '';
};

const errorDetails = (error: unknown, seen = new Set<object>()): string => {
  if (typeof error === 'string') return error;
  if (!error || typeof error !== 'object' || seen.has(error)) return '';
  seen.add(error);
  const fields = ['kind', 'reason', 'code', 'name', 'message']
    .map(field => readErrorField(error, field))
    .filter(Boolean);
  const cause = 'cause' in error ? (error as { cause?: unknown }).cause : undefined;
  if (cause !== undefined) fields.push(errorDetails(cause, seen));
  return fields.filter(Boolean).join(' ');
};

const nestedErrorField = (error: unknown, field: string, seen = new Set<object>()): string => {
  if (!error || typeof error !== 'object' || seen.has(error)) return '';
  seen.add(error);
  const value = readErrorField(error, field);
  if (value) return value;
  const cause = 'cause' in error ? (error as { cause?: unknown }).cause : undefined;
  return cause === undefined ? '' : nestedErrorField(cause, field, seen);
};

export const cardCreatorErrorMessage = (error: unknown): string => {
  const details = errorDetails(error).toLowerCase();
  const code = nestedErrorField(error, 'code').toLowerCase();
  if (details.includes('quota') || details.includes('allowance')) return translate(CREATE_CARD_MESSAGES.errors.quota);
  if (code.includes('requested_deck_unavailable') || details.includes('requested_deck_unavailable')) {
    const deck = nestedErrorField(error, 'deck');
    return deck
      ? translate(CREATE_CARD_MESSAGES.errors.deckUnavailable, { deck })
      : translate(CREATE_CARD_MESSAGES.errors.unavailable);
  }
  if (details.includes('timeout') || details.includes('timed out') || details.includes('quá lâu')) {
    return translate(CREATE_CARD_MESSAGES.errors.timeout);
  }
  if (details.includes('authentication') || details.includes('unauthenticated') || details.includes('sign in')) {
    return translate(CREATE_CARD_MESSAGES.errors.authentication);
  }
  if (details.includes('permission') || details.includes('permission-denied') || details.includes('access denied')) {
    return translate(CREATE_CARD_MESSAGES.errors.permission);
  }
  if (details.includes('configuration') || details.includes('firebase') || details.includes('app check')) {
    return translate(CREATE_CARD_MESSAGES.errors.configuration);
  }
  if (details.includes('network') || details.includes('unavailable') || details.includes('connection')) {
    return translate(CREATE_CARD_MESSAGES.errors.unavailable);
  }
  if (code === 'invalid') return translate(CREATE_CARD_MESSAGES.errors.invalid);
  if (code === 'duplicate') return translate(CREATE_CARD_MESSAGES.errors.duplicateError);
  if (code === 'save') return translate(CREATE_CARD_MESSAGES.errors.save);
  if (code === 'generation') return translate(CREATE_CARD_MESSAGES.errors.generation);
  return translate(CREATE_CARD_MESSAGES.errors.default);
};

const isQuotaError = (error: unknown): boolean => {
  const details = errorDetails(error).toLowerCase();
  return details.includes('quota') || details.includes('allowance');
};

const manualDraftFrom = (model: CardCreatorModel): ManualCardDraft => ({
  word: model.draft.word,
  deck: model.draft.deck,
  partOfSpeech: model.draft.partOfSpeech,
  ...MANUAL_DEFAULTS,
});

const previewManualDraftFrom = (model: CardCreatorModel): ManualCardDraft => ({
  ...manualDraftFrom(model),
  ...(model.preview ? {
    word: model.preview.word,
    translation: model.preview.translation,
    explanation: model.preview.explanation,
    phonetic: model.preview.phonetic,
    exampleSentence: model.preview.exampleSentence ?? '',
    exampleTranslation: model.preview.exampleTranslation ?? '',
    partOfSpeech: model.preview.partOfSpeech ?? model.draft.partOfSpeech,
    deck: model.preview.customDeck ?? model.draft.deck,
  } : {}),
});

const cardFamily = (card: CardData): string => Object.entries(card.wordFamily ?? {})
  .map(([name, value]) => `${name}: ${value}`)
  .join(' · ');

function FieldLabel({ descriptor, optional = false }: { descriptor: MessageDescriptor; optional?: boolean }) {
  return <span className="create-card-dialog__label">{translate(descriptor)}{optional && <em> · {translate(CREATE_CARD_MESSAGES.optional)}</em>}</span>;
}

function SpinnerLabel({ descriptor }: { descriptor: MessageDescriptor }) {
  return <span className="create-card-dialog__spinner-label"><Loader2 size={16} aria-hidden="true" />{translate(descriptor)}</span>;
}

function CardPreview({
  card,
  disabled,
  onUpdate,
  onPlay,
}: {
  card: CardData;
  disabled: boolean;
  onUpdate: (patch: Partial<CardData>) => void;
  onPlay: () => void;
}) {
  const initial = Array.from(card.word.trim())[0]?.toLocaleLowerCase() || '·';
  const family = cardFamily(card);
  const isManual = card.origin === 'manual';
  return (
    <section className="create-card-dialog__preview" aria-labelledby="create-card-preview-title">
      <div className="create-card-dialog__cover" aria-hidden="true">
        {card.imageUrl ? <img src={card.imageUrl} alt="" /> : <span>{initial}</span>}
      </div>
      <div className="create-card-dialog__preview-content">
        <div className="create-card-dialog__preview-heading">
          <span className="create-card-dialog__ai-badge"><Sparkles size={13} aria-hidden="true" />{isManual ? <Trans id="library.create-card.preview.manual-draft" message="Manual draft" /> : <Trans id="library.create-card.preview.ai-draft" message="AI draft" />}</span>
          <span className="create-card-dialog__edit-note">{isManual ? <Trans id="library.create-card.preview.edit-manual" message="Edit your card details below" /> : <Trans id="library.create-card.preview.edit-generated" message="Edit the generated details below" />}</span>
        </div>
        <div className="create-card-dialog__headword-row">
          <h3 id="create-card-preview-title" lang={card.language || 'en'}>{card.word || '—'}</h3>
          {card.word && <button type="button" className="create-card-dialog__audio" onClick={onPlay} aria-label={translate(CREATE_CARD_MESSAGES.playPronunciation, { word: card.word })}><Volume2 size={15} aria-hidden="true" /></button>}
        </div>
        <div className="create-card-dialog__meta">
          <label>
            <span className="sr-only"><Trans id="library.create-card.pronunciation" message="Pronunciation" /></span>
            <input
              aria-label={translate(CREATE_CARD_MESSAGES.pronunciation)}
              lang={card.language || 'en'}
              value={card.phonetic}
              disabled={disabled}
              onChange={event => onUpdate({ phonetic: event.target.value })}
              placeholder={translate(CREATE_CARD_MESSAGES.pronunciationPlaceholder)}
            />
          </label>
          {card.partOfSpeech && <span>{card.partOfSpeech}</span>}
          <label>
            <span className="sr-only"><Trans id="library.create-card.cefr" message="CEFR level" /></span>
            <input
              className="create-card-dialog__cefr-input"
              aria-label={translate(CREATE_CARD_MESSAGES.cefr)}
              value={card.cefrLevel ?? ''}
              disabled={disabled}
              onChange={event => onUpdate({ cefrLevel: event.target.value })}
              placeholder={translate(CREATE_CARD_MESSAGES.cefrPlaceholder)}
            />
          </label>
        </div>
        <label className="create-card-dialog__preview-meaning">
          <span className="sr-only"><Trans id="library.create-card.meaning" message="Meaning" /></span>
          <input
            aria-label={translate(CREATE_CARD_MESSAGES.meaning)}
            lang={card.translationLanguage || 'vi'}
            dir="auto"
            value={card.translation}
            disabled={disabled}
            onChange={event => onUpdate({ translation: event.target.value })}
            placeholder={translate(CREATE_CARD_MESSAGES.meaning)}
          />
        </label>
        <label className="create-card-dialog__preview-explanation">
          <span className="sr-only"><Trans id="library.create-card.definition" message="Definition" /></span>
          <textarea
            aria-label={translate(CREATE_CARD_MESSAGES.definition)}
            lang={card.language || 'en'}
            dir="auto"
            value={card.explanation}
            disabled={disabled}
            rows={2}
            onChange={event => onUpdate({ explanation: event.target.value })}
            placeholder={translate(CREATE_CARD_MESSAGES.definition)}
          />
        </label>
        <div className="create-card-dialog__examples">
          <label>
            <span><Trans id="library.create-card.example" message="Example" /></span>
            <textarea
              aria-label={translate(CREATE_CARD_MESSAGES.exampleSentence)}
              lang={card.language || 'en'}
              dir="auto"
              value={card.exampleSentence ?? ''}
              disabled={disabled}
              rows={2}
              onChange={event => onUpdate({ exampleSentence: event.target.value })}
              placeholder={translate(CREATE_CARD_MESSAGES.exampleSentence)}
            />
          </label>
          <label>
            <span><Trans id="library.create-card.translation" message="Translation" /></span>
            <textarea
              aria-label={translate(CREATE_CARD_MESSAGES.exampleTranslation)}
              lang={card.translationLanguage || 'vi'}
              dir="auto"
              value={card.exampleTranslation ?? ''}
              disabled={disabled}
              rows={2}
              onChange={event => onUpdate({ exampleTranslation: event.target.value })}
              placeholder={translate(CREATE_CARD_MESSAGES.exampleTranslation)}
            />
          </label>
        </div>
        {family && <fieldset className="create-card-dialog__family">
          <legend><Trans id="library.create-card.word-family" message="Word family" /></legend>
          <div className="create-card-dialog__family-fields">
            {(['noun', 'verb', 'adj', 'adv'] as const).filter(key => card.wordFamily?.[key]).map(key => <label key={key}>
              <span>{translate(WORD_FAMILY_MESSAGES[key])}</span>
              <input
                aria-label={translate(CREATE_CARD_MESSAGES.wordFamilyField, { part: translate(WORD_FAMILY_MESSAGES[key]) })}
                value={card.wordFamily?.[key] ?? ''}
                lang={card.language || 'en'}
                dir="auto"
                disabled={disabled}
                onChange={event => onUpdate({ wordFamily: { ...card.wordFamily, [key]: event.target.value } })}
              />
            </label>)}
          </div>
        </fieldset>}
      </div>
    </section>
  );
}

export function CreateCardDialog({ model, actions, deckOptions, allowUnassigned = true }: CreateCardDialogProps) {
  const wordInputRef = useRef<HTMLInputElement | null>(null);
  const audioPlaybackRef = useRef<WordAudioPlayback | null>(null);
  const previousOpenRef = useRef(model.open);
  const [manualMode, setManualMode] = useState(model.mode === 'manual');
  const [manualDraft, setManualDraft] = useState(() => manualDraftFrom(model));
  const [selectedFields, setSelectedFields] = useState<Set<CardGenerationField>>(
    () => new Set(ALL_REGENERABLE_FIELDS),
  );
  const [localError, setLocalError] = useState<string | null>(null);

  const decks = useMemo(
    () => normalizedDeckOptions(deckOptions, model.draft.deck),
    [deckOptions, model.draft.deck],
  );
  const selectedDeck = decks.find(option => option.value === model.draft.deck);
  const deckIsAllowed = model.draft.deck ? isAllowedDeck(selectedDeck) : allowUnassigned;
  const isBusy = model.stage === 'generating' || model.stage === 'saving';
  const hasPreview = model.preview !== null && model.stage !== 'input';
  const error = localError ?? (model.error ? cardCreatorErrorMessage(model.error) : null);
  const quotaError = isQuotaError(model.error)
    || isQuotaError(localError)
    || localError === translate(CREATE_CARD_MESSAGES.errors.quota);

  useEffect(() => () => audioPlaybackRef.current?.cancel(), []);

  useEffect(() => {
    if (!model.open && previousOpenRef.current) {
      setManualMode(false);
      setLocalError(null);
      setManualDraft(manualDraftFrom(model));
    }
    if (model.open && !previousOpenRef.current) {
      setManualMode(model.mode === 'manual');
      setManualDraft(previewManualDraftFrom(model));
      setSelectedFields(new Set(ALL_REGENERABLE_FIELDS));
      setLocalError(null);
    }
    if (model.mode === 'manual') setManualMode(true);
    previousOpenRef.current = model.open;
  }, [model.open, model.mode, model]);

  useEffect(() => {
    if (!model.preview) return;
    setSelectedFields(new Set(ALL_REGENERABLE_FIELDS));
  }, [model.preview?.id]);

  const updateDraft = (patch: Partial<CardCreatorDraft>) => {
    actions.updateDraft(patch);
    if (manualMode) {
      setManualDraft(current => ({
        ...current,
        ...(typeof patch.word === 'string' ? { word: patch.word } : {}),
        ...(typeof patch.partOfSpeech === 'string' ? { partOfSpeech: patch.partOfSpeech } : {}),
        ...(typeof patch.deck === 'string' ? { deck: patch.deck } : {}),
      }));
    }
  };

  const run = async (operation: () => Promise<unknown>) => {
    setLocalError(null);
    try {
      await operation();
    } catch (cause) {
      setLocalError(cardCreatorErrorMessage(cause));
    }
  };

  const generate = () => {
    if (isBusy) return;
    if (!model.draft.word.trim()) {
      setLocalError(translate(CREATE_CARD_MESSAGES.errors.emptyWord));
      wordInputRef.current?.focus();
      return;
    }
    if (!deckIsAllowed) {
      setLocalError(translate(CREATE_CARD_MESSAGES.errors.generateDeck));
      return;
    }
    void run(() => actions.generatePreview());
  };

  const saveManual = () => {
    if (isBusy) return;
    const fields: ManualCardDraft = {
      ...manualDraft,
      word: manualDraft.word.trim(),
      translation: manualDraft.translation.trim(),
      explanation: manualDraft.explanation?.trim() ?? '',
      phonetic: manualDraft.phonetic?.trim() ?? '',
      exampleSentence: manualDraft.exampleSentence?.trim() ?? '',
      exampleTranslation: manualDraft.exampleTranslation?.trim() ?? '',
      deck: model.draft.deck,
    };
    if (!fields.word || !fields.translation) {
      setLocalError(translate(CREATE_CARD_MESSAGES.errors.manualFields));
      if (!fields.word) wordInputRef.current?.focus();
      return;
    }
    if (!deckIsAllowed) {
      setLocalError(translate(CREATE_CARD_MESSAGES.errors.manualDeck));
      return;
    }
    void run(async () => {
      actions.createManualDraft(fields);
      await actions.save();
    });
  };

  const save = () => {
    if (manualMode) {
      saveManual();
      return;
    }
    if (!model.preview || isBusy) return;
    void run(() => actions.save());
  };

  const regenerate = () => {
    if (isBusy) return;
    const fields = REGENERABLE_FIELDS
      .map(field => field.value)
      .filter(field => selectedFields.has(field));
    if (fields.length === 0) {
      setLocalError(translate(CREATE_CARD_MESSAGES.errors.regenerateSelection));
      return;
    }
    void run(() => actions.regenerate(fields));
  };

  const toggleField = (field: CardGenerationField) => {
    setSelectedFields(current => {
      const next = new Set(current);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (manualMode) saveManual();
    else if (hasPreview) save();
    else generate();
  };

  const onClose = () => {
    if (model.stage === 'saving') return;
    audioPlaybackRef.current?.cancel();
    actions.cancel();
  };

  const onPosKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const currentIndex = POS_OPTIONS.findIndex(option => option.value === model.draft.partOfSpeech);
    const index = currentIndex < 0 ? 0 : currentIndex;
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowDown' && event.key !== 'ArrowLeft' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
    const next = POS_OPTIONS[(index + direction + POS_OPTIONS.length) % POS_OPTIONS.length];
    updateDraft({ partOfSpeech: next.value });
    (event.currentTarget.parentElement?.querySelector(`[data-pos="${next.value}"]`) as HTMLButtonElement | null)?.focus();
  };

  const updateManual = <K extends keyof ManualCardDraft>(key: K, value: ManualCardDraft[K]) => {
    setManualDraft(current => ({ ...current, [key]: value }));
    if (key === 'word' || key === 'partOfSpeech') updateDraft({ [key]: value } as Partial<CardCreatorDraft>);
  };

  const enterManualMode = () => {
    setManualDraft(current => ({
      ...current,
      word: model.draft.word,
      deck: model.draft.deck,
      partOfSpeech: model.draft.partOfSpeech,
    }));
    setManualMode(true);
    setLocalError(null);
  };

  return (
    <Dialog.Root open={model.open} onOpenChange={open => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="create-card-dialog__overlay crystal-starfield" />
        <Dialog.Content
          className="create-card-dialog crystal-chamfer"
          aria-describedby="create-card-dialog-description"
          onOpenAutoFocus={event => {
            event.preventDefault();
            wordInputRef.current?.focus();
          }}
          onEscapeKeyDown={event => {
            if (model.stage === 'saving') event.preventDefault();
          }}
          onPointerDownOutside={event => {
            if (model.stage === 'saving') event.preventDefault();
          }}
        >
          <span className="create-card-dialog__ornament create-card-dialog__ornament--top" aria-hidden="true" />
          <span className="create-card-dialog__ornament create-card-dialog__ornament--bottom" aria-hidden="true" />
          <header className="create-card-dialog__header">
            <div className="create-card-dialog__heading">
              <p className="create-card-dialog__kicker"><span aria-hidden="true">◆</span>{manualMode ? <Trans id="library.create-card.kicker.manual" message="MANUAL CARD" /> : <Trans id="library.create-card.kicker.ai" message="NEW CARD" />}</p>
              <Dialog.Title className="create-card-dialog__title"><Trans id="library.create-card.title" message="Add a word" /></Dialog.Title>
              <Dialog.Description id="create-card-dialog-description" className="create-card-dialog__description">
                {manualMode ? <Trans id="library.create-card.description.manual" message="Add the details you already know, then save the card." /> : <Trans id="library.create-card.description.ai" message="SonFlash drafts the card — you decide what stays." />}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="create-card-dialog__close" disabled={model.stage === 'saving'} aria-label={translate(CREATE_CARD_MESSAGES.close)}>
                <X size={17} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </header>

          <form className="create-card-dialog__form" onSubmit={onSubmit}>
            <div className="create-card-dialog__body">
              <div className="create-card-dialog__input-grid">
                <label>
                  <FieldLabel descriptor={CREATE_CARD_MESSAGES.word} />
                  <span className="create-card-dialog__field create-card-dialog__field--active">
                    <input
                      ref={wordInputRef}
                      value={manualMode ? manualDraft.word : model.draft.word}
                      onChange={event => manualMode ? updateManual('word', event.target.value) : updateDraft({ word: event.target.value })}
                      autoComplete="off"
                      required
                      disabled={isBusy}
                      aria-invalid={Boolean(error && !(manualMode ? manualDraft.word : model.draft.word).trim())}
                    />
                  </span>
                </label>
                <label>
                  <FieldLabel descriptor={CREATE_CARD_MESSAGES.context} optional />
                  <span className="create-card-dialog__field">
                    <input
                      value={model.draft.context}
                      onChange={event => updateDraft({ context: event.target.value })}
                      placeholder={translate(CREATE_CARD_MESSAGES.contextPlaceholder)}
                      autoComplete="off"
                      disabled={isBusy}
                    />
                  </span>
                </label>
              </div>

              <fieldset className="create-card-dialog__pos">
                <legend><Trans id="library.create-card.part-of-speech" message="Part of speech" /></legend>
                <div role="radiogroup" aria-label={translate(CREATE_CARD_MESSAGES.partOfSpeech)}>
                  {POS_OPTIONS.map(option => {
                    const selected = model.draft.partOfSpeech === option.value;
                    return <button
                      key={option.value || 'auto'}
                      type="button"
                      role="radio"
                      data-pos={option.value}
                      aria-checked={selected}
                      className={selected ? 'is-selected' : ''}
                      disabled={isBusy}
                      onClick={() => updateDraft({ partOfSpeech: option.value })}
                      onKeyDown={onPosKeyDown}
                    ><span>{translate(option.label)}</span></button>;
                  })}
                </div>
              </fieldset>

              {model.preview ? (
                <>
                  <CardPreview
                    card={model.preview}
                    disabled={isBusy}
                    onUpdate={patch => actions.updatePreview(patch)}
                    onPlay={() => {
                      audioPlaybackRef.current?.cancel();
                      audioPlaybackRef.current = playWordAudio(model.preview?.word ?? '', model.preview?.audioUrl ?? null, model.preview?.language === 'vi' ? 'vi-VN' : 'en-US');
                    }}
                  />
                  {!manualMode && <div className="create-card-dialog__regeneration" aria-label={translate(CREATE_CARD_MESSAGES.regenerateGroup)}>
                    <div className="create-card-dialog__regeneration-heading"><span><Trans id="library.create-card.regenerate-selected" message="Regenerate selected details" /></span><small><Trans id="library.create-card.regenerate-hint" message="Each completed generation uses one AI request" /></small></div>
                    <div className="create-card-dialog__regeneration-options">
                      {REGENERABLE_FIELDS.map(field => <button
                        key={field.value}
                        type="button"
                        aria-pressed={selectedFields.has(field.value)}
                        className={selectedFields.has(field.value) ? 'is-selected' : ''}
                        disabled={isBusy}
                        onClick={() => toggleField(field.value)}
                      ><Check size={13} aria-hidden="true" />{translate(field.label)}</button>)}
                    </div>
                  </div>}
                </>
              ) : manualMode ? (
                <section className="create-card-dialog__manual" aria-labelledby="manual-card-heading">
                  <div className="create-card-dialog__section-heading">
                    <div><p className="create-card-dialog__section-kicker"><Trans id="library.create-card.manual-details" message="MANUAL DETAILS" /></p><h3 id="manual-card-heading"><Trans id="library.create-card.your-card" message="Your card" /></h3></div>
                    <button type="button" className="create-card-dialog__text-button" disabled={isBusy} onClick={() => { setManualMode(false); setLocalError(null); }}><Trans id="library.create-card.use-ai-draft" message="Use AI draft" /></button>
                  </div>
                  <div className="create-card-dialog__manual-grid">
                    <label><FieldLabel descriptor={CREATE_CARD_MESSAGES.meaning} /><input dir="auto" value={manualDraft.translation} onChange={event => updateManual('translation', event.target.value)} required disabled={isBusy} /></label>
                    <label><FieldLabel descriptor={CREATE_CARD_MESSAGES.pronunciation} optional /><input dir="auto" value={manualDraft.phonetic ?? ''} onChange={event => updateManual('phonetic', event.target.value)} placeholder={translate(CREATE_CARD_MESSAGES.pronunciationPlaceholder)} disabled={isBusy} /></label>
                    <label className="is-wide"><FieldLabel descriptor={CREATE_CARD_MESSAGES.definition} optional /><textarea dir="auto" rows={2} value={manualDraft.explanation ?? ''} onChange={event => updateManual('explanation', event.target.value)} disabled={isBusy} /></label>
                    <label><FieldLabel descriptor={CREATE_CARD_MESSAGES.exampleSentence} optional /><textarea dir="auto" rows={2} value={manualDraft.exampleSentence ?? ''} onChange={event => updateManual('exampleSentence', event.target.value)} disabled={isBusy} /></label>
                    <label><FieldLabel descriptor={CREATE_CARD_MESSAGES.exampleTranslation} optional /><textarea dir="auto" rows={2} value={manualDraft.exampleTranslation ?? ''} onChange={event => updateManual('exampleTranslation', event.target.value)} disabled={isBusy} /></label>
                  </div>
                </section>
              ) : (
                <div className="create-card-dialog__empty-preview" role="status">
                  <Sparkles size={18} aria-hidden="true" />
                  <span>{isBusy ? <Trans id="library.create-card.preparing" message="SonFlash is preparing your card…" /> : <Trans id="library.create-card.empty-preview" message="Your generated card preview will appear here." />}</span>
                </div>
              )}

              <div className="create-card-dialog__save-row">
                <label><FieldLabel descriptor={CREATE_CARD_MESSAGES.saveTo} />
                  <select value={model.draft.deck} onChange={event => updateDraft({ deck: event.target.value })} disabled={isBusy} aria-invalid={!deckIsAllowed}>
                    {allowUnassigned && <option value="">{translate(CREATE_CARD_MESSAGES.unassigned)}</option>}
                    {decks.map(option => <option key={option.value} value={option.value} disabled={option.disabled || option.allowed === false}>
                      {option.label ?? option.value}{option.disabled || option.allowed === false ? ` · ${deckOptionReason(option.reason)}` : ''}
                    </option>)}
                  </select>
                </label>
                {!manualMode && hasPreview && <p><Trans id="library.create-card.ready-after-saving" message="Ready after saving" /></p>}
              </div>

              {model.duplicate && <div className="create-card-dialog__notice create-card-dialog__notice--duplicate" role="alert">
                <AlertCircle size={17} aria-hidden="true" />
                <span>{translate(CREATE_CARD_MESSAGES.duplicate, { word: model.duplicate.word })}</span>
              </div>}
              {error && <div className={`create-card-dialog__notice ${quotaError ? 'create-card-dialog__notice--quota' : 'create-card-dialog__notice--error'}`} role="alert">
                <AlertCircle size={17} aria-hidden="true" />
                <span>{error}{quotaError && !manualMode && <button type="button" onClick={enterManualMode}><Trans id="library.create-card.add-manually" message="Add manually" /></button>}</span>
              </div>}
            </div>

            <footer className="create-card-dialog__footer">
              <span className="create-card-dialog__request-count"><Sparkles size={14} aria-hidden="true" /><Trans id="library.create-card.request-count" message="{count, plural, one {# AI request completed} other {# AI requests completed}}" values={{ count: model.completedAiRequests }} /></span>
              {!manualMode && !hasPreview && <button type="button" className="create-card-dialog__manual-link" onClick={enterManualMode}><Trans id="library.create-card.add-manually" message="Add manually" /></button>}
              {!manualMode && hasPreview && <button type="button" className="create-card-dialog__secondary" onClick={regenerate} disabled={isBusy || selectedFields.size === 0}><RefreshCw size={15} aria-hidden="true" />{model.stage === 'generating' ? <SpinnerLabel descriptor={CREATE_CARD_MESSAGES.regenerating} /> : <Trans id="library.create-card.regenerate" message="Regenerate" />}</button>}
              <button type="submit" className="create-card-dialog__primary" disabled={isBusy || Boolean(model.duplicate) || (!manualMode && !model.draft.word.trim()) || !deckIsAllowed}>
                {model.stage === 'generating' && !hasPreview ? <SpinnerLabel descriptor={CREATE_CARD_MESSAGES.generating} /> : model.stage === 'saving' ? <SpinnerLabel descriptor={CREATE_CARD_MESSAGES.saving} /> : manualMode ? <Trans id="library.create-card.save" message="Save card" /> : hasPreview ? <Trans id="library.create-card.save" message="Save card" /> : <Trans id="library.create-card.generate-preview" message="Generate preview" />}
              </button>
            </footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
