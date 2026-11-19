import * as Dialog from '@radix-ui/react-dialog';
import { i18n, type MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Check, Loader2, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { normalizeCardWord } from '../../lib/cardIdentity';
import { extractVocabulary } from '../../lib/gemini';
import { getProtectedFunctionUserMessage, ProtectedFunctionError } from '../../lib/protectedFunctionsCapability';
import type { CardData } from '../../types/card';
import { ENGLISH_TO_VIETNAMESE_PROFILE, type LanguageProfile } from '../language/languageProfile';
import './library-dialog-overlays.css';

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

  const passageWordCount = inputText.trim() ? inputText.trim().split(/\s+/u).length : 0;
  const hasResults = scopedExtractedWords.length > 0;
  const ownedCount = scopedExtractedWords.filter(item => existingWordKeys.has(normalizeCardWord(item.word))).length;
  const extractButton = (variant: 'primary' | 'link') => (
    <button
      type="button"
      onClick={handleExtract}
      disabled={isLoading || !inputText.trim()}
      className={variant === 'primary' ? 'library-dialog-button library-dialog-button--primary' : 'library-dialog-link word-extractor-rerun'}
    >
      {isLoading ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}
      <span>{isLoading
        ? translate(msg({ id: 'library.extract.loading', message: 'AI is analyzing the text…' }))
        : translate(msg({ id: 'library.extract.submit', message: 'Extract vocabulary' }))}</span>
    </button>
  );

  return (
    <div className="word-extractor" aria-busy={isLoading}>
      <header className="library-dialog-header">
        <div className="min-w-0">
          <p className="library-dialog-kicker">
            {translate(msg({ id: 'library.extract.eyebrow', message: 'Word extractor' }))}
          </p>
          <Dialog.Title className="library-dialog-title">
            {translate(msg({ id: 'library.extract.title', message: 'Scan text' }))}
          </Dialog.Title>
          <Dialog.Description className="library-dialog-description">
            {translate(msg({ id: 'library.extract.description', message: 'Paste a passage and SonFlash pulls out words worth learning.' }))}
          </Dialog.Description>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="library-dialog-icon-button"
          aria-label={translate(msg({ id: 'library.close', message: 'Close' }))}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      <div className="library-dialog-body word-extractor-body">
        <div className="word-extractor-passage">
          <label htmlFor="extractor-input" className="sr-only">
            {translate(msg({ id: 'library.extract.input-label', message: 'Text to scan' }))}
          </label>
          <textarea
            id="extractor-input"
            lang={languageProfile.source.code}
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            placeholder={translate(msg({ id: 'library.extract.input-placeholder', message: 'Paste a paragraph, email, reading passage or book page here…' }))}
            rows={5}
            className="word-extractor-input"
          />
          {passageWordCount > 0 && (
            <span className="word-extractor-count" aria-hidden="true">
              {translate(msg({ id: 'library.extract.word-count', message: '{count, plural, one {# word} other {# words}}' }), { count: passageWordCount })}
            </span>
          )}
        </div>

        {isScopeCurrent && error !== null && (
          <p role="alert" className="library-dialog-error">
            {extractionFailureMessage(error)}
          </p>
        )}

        {hasResults && (
          <div className="word-extractor-results">
            <div className="word-extractor-results-head">
              <p>
                <strong>{translate(msg({ id: 'library.extract.found', message: 'Found {count, plural, one {# word} other {# words}}' }), { count: scopedExtractedWords.length })}</strong>
                {ownedCount > 0
                  ? <span>{translate(msg({ id: 'library.extract.already-owned', message: '{count, plural, one {# already in your library} other {# already in your library}}' }), { count: ownedCount })}</span>
                  : null}
              </p>
              <button
                type="button"
                onClick={() => {
                  if (allSelectableWordsSelected) setSelectedWords(new Set());
                  else setSelectedWords(new Set(selectableWords.map(w => w.word)));
                }}
                disabled={selectableWords.length === 0}
                className="library-dialog-link word-extractor-toggle"
              >
                {allSelectableWordsSelected
                  ? translate(msg({ id: 'library.extract.deselect-all', message: 'Clear selection' }))
                  : translate(msg({ id: 'library.extract.select-all', message: 'Select all' }))}
              </button>
            </div>

            <div className="word-extractor-grid">
              {scopedExtractedWords.map((item, i) => {
                const isExisting = existingWordKeys.has(normalizeCardWord(item.word));
                const isSelected = importableSelectedWords.includes(item);
                const tag = isExisting
                  ? translate(msg({ id: 'library.extract.in-library', message: 'In library' }))
                  : item.cefrLevel || item.partOfSpeech;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => toggleSelect(item.word)}
                    disabled={isExisting}
                    aria-disabled={isExisting}
                    aria-pressed={isSelected}
                    className={`word-extractor-row${isSelected ? ' is-selected' : ''}${isExisting ? ' is-owned' : ''}`}
                  >
                    <span className="word-extractor-check" aria-hidden="true">
                      {isSelected && <Check size={13} strokeWidth={3} />}
                    </span>
                    <span lang={languageProfile.source.code} className="word-extractor-word">{item.word}</span>
                    <span lang={languageProfile.target.code} className="word-extractor-meaning">{item.translation}</span>
                    {tag ? <span lang={isExisting || item.cefrLevel ? undefined : languageProfile.source.code} className="word-extractor-tag">{tag}</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <footer className="library-dialog-footer word-extractor-footer">
        {hasResults ? extractButton('link') : <span />}
        <button type="button" onClick={onClose} className="library-dialog-button library-dialog-button--secondary">
          {translate(msg({ id: 'common.cancel', message: 'Cancel' }))}
        </button>
        {hasResults ? (
          <button
            type="button"
            onClick={handleAddAllSelected}
            disabled={importableSelectedWords.length === 0}
            className="library-dialog-button library-dialog-button--primary"
          >
            <span>{translate(msg({ id: 'library.extract.save-selected', message: 'Save {count, plural, one {# card} other {# cards}}' }), { count: importableSelectedWords.length })}</span>
          </button>
        ) : extractButton('primary')}
      </footer>
    </div>
  );
}

export function WordExtractorModal({ open, onOpenChange, onImportWords, onImportItems, cards = [], restoreFocusRef, languageProfile, ownerId }: WordExtractorModalProps) {
  if (!open) return null;
  const activeLanguageProfile = languageProfile ?? ENGLISH_TO_VIETNAMESE_PROFILE;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="library-dialog-overlay" />
        <Dialog.Content
          className="library-dialog-frame library-dialog-frame--extract"
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
