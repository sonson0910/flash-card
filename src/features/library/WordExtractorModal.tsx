import * as Dialog from '@radix-ui/react-dialog';
import { i18n, type MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Check, Loader2, Plus, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { normalizeCardWord } from '../../lib/cardIdentity';
import { extractVocabulary } from '../../lib/gemini';
import { getProtectedFunctionUserMessage, ProtectedFunctionError } from '../../lib/protectedFunctionsCapability';
import type { CardData } from '../../types/card';
import { ENGLISH_TO_VIETNAMESE_PROFILE, type LanguageProfile } from '../language/languageProfile';

export interface ExtractedWordItem {
  word: string;
  translation: string;
  partOfSpeech: string;
  cefrLevel: string;
  example: string;
}

export function getSelectableExtractedWords(
  words: readonly ExtractedWordItem[],
  cards: readonly Pick<CardData, 'word' | 'normalizedWord'>[],
): ExtractedWordItem[] {
  const existingWordKeys = new Set(cards.map(card => normalizeCardWord(card.normalizedWord || card.word)));
  return words.filter(item => Boolean(item.word.trim()) && Boolean(item.translation.trim())
    && !existingWordKeys.has(normalizeCardWord(item.word)));
}

export const selectedExtractedWords = (
  words: readonly ExtractedWordItem[],
  selectedWords: ReadonlySet<string>,
) => words.filter(item => selectedWords.has(item.word) && Boolean(item.word.trim()) && Boolean(item.translation.trim()));

const importableSelectedExtractedWords = (
  words: readonly ExtractedWordItem[],
  selectedWords: ReadonlySet<string>,
  cards: readonly Pick<CardData, 'word' | 'normalizedWord'>[],
) => getSelectableExtractedWords(selectedExtractedWords(words, selectedWords), cards);

export const extractorItemsForScope = (
  items: readonly ExtractedWordItem[],
  itemsScope: string,
  currentScope: string,
) => itemsScope === currentScope ? items : [];

export const extractorSelectionForScope = (
  selectedWords: ReadonlySet<string>,
  itemsScope: string,
  currentScope: string,
) => itemsScope === currentScope ? selectedWords : new Set<string>();

export const extractorScopeKey = (languageProfile: LanguageProfile, ownerId?: string | null) =>
  `${ownerId ?? ''}:${languageProfile.id}`;

export function useExtractorRequestGuard() {
  const activeRef = useRef(true);
  const generationRef = useRef(0);
  useEffect(() => () => {
    activeRef.current = false;
    generationRef.current += 1;
  }, []);
  return useCallback(() => {
    const generation = ++generationRef.current;
    return { isCurrent: () => activeRef.current && generationRef.current === generation };
  }, []);
}

interface WordExtractorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportWords?: (words: string[]) => void;
  onImportItems?: (items: ExtractedWordItem[]) => void;
  cards?: readonly Pick<CardData, 'word' | 'normalizedWord'>[];
  restoreFocusRef?: RefObject<HTMLElement | null>;
  languageProfile?: LanguageProfile;
  ownerId?: string | null;
}

const translate = (descriptor: MessageDescriptor, values?: Record<string, unknown>) =>
  i18n.locale ? i18n._(descriptor.id, values) : descriptor.message ?? descriptor.id;

export function extractionFailureMessage(error: unknown): string {
  if (error instanceof ProtectedFunctionError) {
    if (error.reason === 'service-daily-cap') return translate(msg({ id: 'library.extract.error.service-daily-cap', message: 'AI is paused because today’s shared limit is exhausted. Try again after 00:00 Vietnam time.' }));
    if (error.reason === 'account-daily-spend') return translate(msg({ id: 'library.extract.error.account-daily-spend', message: 'You have reached your AI spending limit for today. Try again after 00:00 Vietnam time.' }));
    if (error.reason === 'ai-card-quota') return translate(msg({ id: 'library.extract.error.ai-card-quota', message: 'You have used your AI card allowance for this period. See Pro or wait for the next period; adding words manually still works.' }));
    if (error.reason === 'ai-daily-allowance') return translate(msg({ id: 'library.extract.error.ai-daily-allowance', message: 'You have used today’s extra AI allowance. Try again after 00:00 Vietnam time.' }));
    if (error.reason === 'operation-in-flight') return translate(msg({ id: 'library.extract.error.operation-in-flight', message: 'AI is still analyzing this text. Try again in a few seconds.' }));
    if (error.kind === 'quota') return translate(msg({ id: 'library.extract.error.quota', message: 'AI usage limit reached. Try again when your allowance resets.' }));
  }
  return getProtectedFunctionUserMessage(error)
    ?? translate(msg({ id: 'library.extract.error.default', message: 'Could not extract vocabulary from this text. Please try again.' }));
}

export function WordExtractorContent({
  onClose,
  onImportWords,
  onImportItems,
  cards = [],
  languageProfile = ENGLISH_TO_VIETNAMESE_PROFILE,
  ownerId,
}: {
  onClose: () => void;
  onImportWords?: (words: string[]) => void;
  onImportItems?: (items: ExtractedWordItem[]) => void;
  cards?: readonly Pick<CardData, 'word' | 'normalizedWord'>[];
  languageProfile?: LanguageProfile;
  ownerId?: string | null;
}) {
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [extractedWords, setExtractedWords] = useState<ExtractedWordItem[]>([]);
  const [selectedWords, setSelectedWords] = useState<Set<string>>(new Set());
  const [error, setError] = useState<unknown>(null);
  const scopeKey = extractorScopeKey(languageProfile, ownerId);
  const [itemsScope, setItemsScope] = useState(scopeKey);
  const beginRequest = useExtractorRequestGuard();
  const scopedExtractedWords = extractorItemsForScope(extractedWords, itemsScope, scopeKey);
  const scopedSelectedWords = extractorSelectionForScope(selectedWords, itemsScope, scopeKey);
  const isScopeCurrent = itemsScope === scopeKey;
  const existingWordKeys = new Set(cards.map(card => normalizeCardWord(card.normalizedWord || card.word)));
  const selectableWords = getSelectableExtractedWords(scopedExtractedWords, cards);
  const importableSelectedWords = importableSelectedExtractedWords(scopedExtractedWords, scopedSelectedWords, cards);
  const allSelectableWordsSelected = selectableWords.length > 0 && importableSelectedWords.length === selectableWords.length;

  useEffect(() => {
    setIsLoading(false);
    setExtractedWords([]);
    setSelectedWords(new Set());
    setError(null);
  }, [scopeKey]);

  const handleExtract = async () => {
    if (!inputText.trim()) return;

    const request = beginRequest();

    setIsLoading(true);
    setItemsScope(scopeKey);
    setError(null);
    setExtractedWords([]);
    setSelectedWords(new Set());

    try {
      const parsed = await extractVocabulary(inputText, {
        targetLanguage: languageProfile.source.code, translationLanguage: languageProfile.target.code,
      }, ownerId);
      if (!request.isCurrent()) return;
      const seen = new Set<string>();
      const validWords = parsed.flatMap(value => {
        if (!value || typeof value !== 'object') return [];
        const item = value as Partial<ExtractedWordItem>;
        const word = typeof item.word === 'string' ? item.word.trim() : '';
        const translation = typeof item.translation === 'string' ? item.translation.trim() : '';
        const key = normalizeCardWord(word);
        if (!key || !translation || seen.has(key)) return [];
        seen.add(key);
        return [{
          word,
          translation,
          partOfSpeech: typeof item.partOfSpeech === 'string' ? item.partOfSpeech.trim() : '',
          cefrLevel: typeof item.cefrLevel === 'string' ? item.cefrLevel.trim() : '',
          example: typeof item.example === 'string' ? item.example.trim() : '',
        }];
      });
      if (validWords.length === 0) throw new Error('No vocabulary found');
      setItemsScope(scopeKey);
      setExtractedWords(validWords);
      setSelectedWords(new Set(getSelectableExtractedWords(validWords, cards).map(item => item.word)));
    } catch (error) {
      if (request.isCurrent()) setError(error);
    } finally {
      if (request.isCurrent()) setIsLoading(false);
    }
  };

  const toggleSelect = (word: string) => {
    if (existingWordKeys.has(normalizeCardWord(word)) || !scopedExtractedWords.some(item => item.word === word && item.translation.trim())) return;
    const next = new Set(scopedSelectedWords);
    if (next.has(word)) next.delete(word);
    else next.add(word);
    setSelectedWords(next);
  };

  const handleAddAllSelected = () => {
    const items = importableSelectedExtractedWords(scopedExtractedWords, scopedSelectedWords, cards);
    if (items.length > 0) {
      if (onImportItems) onImportItems(items);
      else onImportWords?.(items.map(item => item.word));
      onClose();
      setInputText('');
      setExtractedWords([]);
    }
  };

  return (
    <div
      className="library-dialog-canvas max-h-[calc(100dvh-2rem)] w-full overflow-y-auto rounded-[28px] border border-[var(--sf-border)] bg-[var(--sf-surface)] text-[var(--sf-text)] shadow-2xl outline-none"
      aria-busy={isLoading}
    >
      <header className="flex items-start justify-between gap-4 border-b border-[var(--sf-border)] px-5 py-5 sm:px-7">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--sf-text-muted)]">
            {translate(msg({ id: 'library.extract.eyebrow', message: 'Word extractor' }))}
          </p>
          <div>
            <Dialog.Title className="mt-1 font-display text-3xl font-semibold tracking-tight text-[var(--sf-text)]">
              {translate(msg({ id: 'library.extract.title', message: 'Scan text' }))}
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-sm leading-6 text-[var(--sf-text-muted)]">
              {translate(msg({ id: 'library.extract.description', message: 'Paste a passage and SonFlash pulls out words worth learning.' }))}
            </Dialog.Description>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex size-9 shrink-0 items-center justify-center rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-text-muted)] transition-colors hover:border-[var(--sf-brand)] hover:text-[var(--sf-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)]"
          aria-label={translate(msg({ id: 'library.close', message: 'Close' }))}
        >
          <X size={16} />
        </button>
      </header>

      <div className="space-y-4 px-5 py-5 sm:px-7">
        <div>
          <label htmlFor="extractor-input" className="mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-[var(--sf-text-muted)]">
            {translate(msg({ id: 'library.extract.input-label', message: 'Text to scan' }))}
          </label>
          <textarea
            id="extractor-input"
            lang={languageProfile.source.code}
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            placeholder={translate(msg({ id: 'library.extract.input-placeholder', message: 'Paste a paragraph, email, reading passage or book page here…' }))}
            rows={5}
            className="w-full rounded-[14px] border border-[var(--sf-border)] bg-[var(--sf-surface-control)] p-4 text-sm leading-7 text-[var(--sf-text)] placeholder:text-[var(--sf-text-muted)] focus:border-[var(--sf-brand)] focus:outline-hidden focus:ring-2 focus:ring-[var(--sf-brand)]/20"
          />
        </div>

        {isScopeCurrent && error !== null && (
          <p role="alert" className="rounded-[14px] border border-rose-400/30 bg-rose-500/10 p-3 text-sm font-medium text-rose-700 dark:text-rose-200">
            {extractionFailureMessage(error)}
          </p>
        )}

        <button
          type="button"
          onClick={handleExtract}
          disabled={isLoading || !inputText.trim()}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--sf-brand)] px-5 text-sm font-semibold text-[var(--sf-on-brand)] shadow-[var(--sf-shadow)] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)] disabled:opacity-50"
        >
          {isLoading ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              <span>{translate(msg({ id: 'library.extract.loading', message: 'AI is analyzing the text…' }))}</span>
            </>
          ) : (
            <>
              <Sparkles size={18} />
              <span>{translate(msg({ id: 'library.extract.submit', message: 'Extract vocabulary' }))}</span>
            </>
          )}
        </button>

        {/* Extracted Words Result List */}
        {scopedExtractedWords.length > 0 && (
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-[var(--sf-text)]">
                {translate(msg({ id: 'library.extract.found', message: 'Found {count, plural, one {# word} other {# words}}' }), { count: scopedExtractedWords.length })}
                {existingWordKeys.size > 0 && scopedExtractedWords.some(item => existingWordKeys.has(normalizeCardWord(item.word)))
                  ? <span className="ml-2 text-xs font-normal text-[var(--sf-text-muted)]">{translate(msg({ id: 'library.extract.already-owned', message: '{count, plural, one {# already in your library} other {# already in your library}}' }), { count: scopedExtractedWords.filter(item => existingWordKeys.has(normalizeCardWord(item.word))).length })}</span>
                  : null}
              </span>
              <button
                type="button"
                onClick={() => {
                  if (allSelectableWordsSelected) setSelectedWords(new Set());
                  else setSelectedWords(new Set(selectableWords.map(w => w.word)));
                }}
                disabled={selectableWords.length === 0}
                className="text-xs font-semibold text-[var(--sf-brand-text)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)]"
              >
                {allSelectableWordsSelected
                  ? translate(msg({ id: 'library.extract.deselect-all', message: 'Clear selection' }))
                  : translate(msg({ id: 'library.extract.select-all', message: 'Select all' }))}
              </button>
            </div>

            <div className="grid max-h-64 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
              {scopedExtractedWords.map((item, i) => {
                const isExisting = existingWordKeys.has(normalizeCardWord(item.word));
                const isSelected = importableSelectedWords.includes(item);
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => toggleSelect(item.word)}
                    disabled={isExisting}
                    aria-disabled={isExisting}
                    aria-pressed={isSelected}
                    className={`flex w-full items-start gap-3 rounded-[14px] border p-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)] ${
                      isSelected
                        ? 'border-[var(--sf-brand)] bg-[color-mix(in_srgb,var(--sf-brand)_10%,var(--sf-surface))]'
                        : `border-[var(--sf-border)] bg-[var(--sf-surface-raised)] ${isExisting ? 'opacity-50' : 'opacity-70'}`
                    }`}
                  >
                    <div
                      className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border ${
                        isSelected
                          ? 'border-[var(--sf-brand)] bg-[var(--sf-brand)] text-[var(--sf-on-brand)]'
                          : 'border-[var(--sf-border)] bg-[var(--sf-surface)]'
                      }`}
                    >
                      {isSelected && <Check size={13} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span lang={languageProfile.source.code} className="font-display text-base font-semibold text-[var(--sf-text)]">{item.word}</span>
                        {item.cefrLevel
                          ? <span className="rounded-md bg-[var(--sf-surface-muted)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--sf-text-muted)]">{item.cefrLevel}</span>
                          : <span lang={languageProfile.source.code} className="rounded-md bg-[var(--sf-surface-muted)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--sf-text-muted)]">{isExisting ? translate(msg({ id: 'library.extract.in-library', message: 'In library' })) : item.partOfSpeech}</span>}
                      </div>
                      <p lang={languageProfile.target.code} className="text-xs text-[var(--sf-text-muted)] mt-0.5">{item.translation}</p>
                    </div>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={handleAddAllSelected}
              disabled={importableSelectedWords.length === 0}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--sf-brand)] px-4 text-sm font-semibold text-[var(--sf-on-brand)] shadow-[var(--sf-shadow)] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)] disabled:opacity-50"
            >
              <Plus size={16} />
              <span>{translate(msg({ id: 'library.extract.create-selected', message: 'Create {count, plural, one {# flashcard} other {# flashcards}}' }), { count: importableSelectedWords.length })}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function WordExtractorModal({ open, onOpenChange, onImportWords, onImportItems, cards = [], restoreFocusRef, languageProfile, ownerId }: WordExtractorModalProps) {
  if (!open) return null;
  const activeLanguageProfile = languageProfile ?? ENGLISH_TO_VIETNAMESE_PROFILE;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed inset-x-4 top-1/2 z-50 mx-auto w-auto max-w-2xl -translate-y-1/2 focus:outline-none sm:inset-x-6"
          onCloseAutoFocus={event => {
            if (!restoreFocusRef?.current) return;
            event.preventDefault();
            restoreFocusRef.current.focus();
          }}
        >
          <WordExtractorContent
            key={extractorScopeKey(activeLanguageProfile, ownerId)}
            onClose={() => onOpenChange(false)}
            onImportWords={onImportWords}
            onImportItems={onImportItems}
            cards={cards}
            languageProfile={activeLanguageProfile}
            ownerId={ownerId}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
