import * as Dialog from '@radix-ui/react-dialog';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { ArrowRight, Sparkles, X } from 'lucide-react';
import { Fragment, useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import type { CardData } from '../../types/card';
import { currentOwnerId, observeOwner } from '../../features/session/ownerSessionPort';
import { askCardTutor, type CardTutorTurn } from '../../lib/gemini';
import { ProtectedFunctionError } from '../../lib/protectedFunctionsCapability';
import { Lumi } from '../lumi/Lumi';
import '../overlay-dialog.css';
import './CardAiAssistantModal.css';

interface CardAiAssistantModalProps {
  card: CardData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restoreFocusRef?: RefObject<Pick<HTMLElement, 'focus'> | null>;
}

const PRESET_PROMPTS = [
  {
    label: msg({ id: 'flashcard.ai.work-examples', message: '3 work examples' }),
    prompt: 'Give me three realistic work examples for this word.',
  },
  {
    label: msg({ id: 'flashcard.ai.synonym-nuances', message: 'Synonym nuances' }),
    prompt: 'How does this word differ from its closest synonyms?',
  },
  {
    label: msg({ id: 'flashcard.ai.idioms-collocations', message: 'Natural idioms & collocations' }),
    prompt: 'Show natural collocations and one example for each.',
  },
  {
    label: msg({ id: 'flashcard.ai.explain-meaning', message: 'Explain this meaning' }),
    prompt: 'Explain this meaning simply and show when to use it.',
  },
];

export function CardAiAssistantModal({
  card,
  open,
  onOpenChange,
  restoreFocusRef,
}: CardAiAssistantModalProps) {
  const { _, i18n } = useLingui();
  const [customQuery, setCustomQuery] = useState('');
  const [activeQuestion, setActiveQuestion] = useState('');
  const [turns, setTurns] = useState<Array<CardTutorTurn & { label?: string }>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const requestInFlight = useRef(false);
  const requestAbortController = useRef<AbortController | null>(null);
  const turnsRef = useRef<Array<CardTutorTurn & { label?: string }>>([]);

  const abortRequest = () => {
    requestVersion.current += 1;
    requestInFlight.current = false;
    requestAbortController.current?.abort();
    requestAbortController.current = null;
  };

  useEffect(() => {
    abortRequest();
    turnsRef.current = [];
    setCustomQuery('');
    setActiveQuestion('');
    setTurns([]);
    setIsLoading(false);
    setError(null);
  }, [card.id, open]);

  useEffect(() => {
    let ownerId = currentOwnerId();
    const stop = observeOwner(nextOwnerId => {
      if (nextOwnerId === ownerId) return;
      ownerId = nextOwnerId;
      abortRequest();
      turnsRef.current = [];
      setCustomQuery('');
      setActiveQuestion('');
      setTurns([]);
      setIsLoading(false);
      setError(null);
    });
    return () => {
      abortRequest();
      stop?.();
    };
  }, []);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      abortRequest();
    }
    onOpenChange(nextOpen);
  };

  const askAi = async (questionPrompt: string, userFriendlyLabel?: string) => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    const controller = new AbortController();
    requestAbortController.current = controller;
    const ownerId = currentOwnerId();
    const version = ++requestVersion.current;
    setActiveQuestion(userFriendlyLabel || questionPrompt);
    setIsLoading(true);
    setError(null);

    try {
      const answer = await askCardTutor(card.id, questionPrompt, turnsRef.current, controller.signal);
      if (version !== requestVersion.current || ownerId !== currentOwnerId()) return;
      const updatedTurns = [...turnsRef.current, { question: questionPrompt, answer, label: userFriendlyLabel }].slice(-3);
      turnsRef.current = updatedTurns;
      setTurns(updatedTurns);
      setActiveQuestion('');
      if (!userFriendlyLabel) setCustomQuery('');
    } catch (failure) {
      if (version !== requestVersion.current || ownerId !== currentOwnerId()) return;
      setError(failure instanceof ProtectedFunctionError && failure.reason === 'ai-daily-allowance'
        ? _(msg({ id: 'flashcard.ai.limit', message: 'AI Tutor limit reached. Try again when your daily allowance resets.' }))
        : failure instanceof ProtectedFunctionError && failure.kind === 'quota'
          ? _(msg({ id: 'flashcard.ai.usage-limit', message: 'AI Tutor is at its usage limit. Try again later.' }))
        : _(msg({ id: 'flashcard.ai.busy', message: 'AI is currently busy. Please try again in a few seconds!' })));
    } finally {
      if (version === requestVersion.current && ownerId === currentOwnerId()) {
        requestInFlight.current = false;
        requestAbortController.current = null;
        setIsLoading(false);
      }
    }
  };

  const handleCustomSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!customQuery.trim() || customQuery.trim().length > 300 || isLoading) return;
    const query = customQuery.trim();
    void askAi(query);
  };

  const phonetic = card.phonetic.trim().replace(/^\/+|\/+$/g, '');
  const partOfSpeech = card.partOfSpeech?.trim() ?? '';
  const translation = card.translation.trim();
  const senseParts = [
    phonetic ? <span key="ipa" className="card-tutor-ipa">/{phonetic}/</span> : null,
    partOfSpeech ? <span key="pos" lang={card.language || 'en'}>{partOfSpeech}</span> : null,
    translation ? <span key="meaning" lang={card.translationLanguage || 'vi'} className="card-tutor-meaning">{translation}</span> : null,
  ].filter(part => part !== null);
  const lastQuestion = activeQuestion || turns.at(-1)?.label || turns.at(-1)?.question || '';

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="crystal-starfield fixed inset-0 z-[110] dialog-veil" />
        <Dialog.Content
          className="overlay-dialog-frame card-tutor"
          aria-describedby={`ai-assistant-description-${card.id}`}
          onCloseAutoFocus={event => {
            event.preventDefault();
            restoreFocusRef?.current?.focus({ preventScroll: true });
          }}
        >
          <div className="overlay-dialog-body">
            <span aria-hidden="true" className="overlay-dialog-ornament overlay-dialog-ornament-top" />
            <span aria-hidden="true" className="overlay-dialog-ornament overlay-dialog-ornament-bottom" />
            <div className="overlay-dialog-header">
              <span aria-hidden="true" className="card-tutor-mark"><Sparkles /></span>
              <span aria-hidden="true" className="card-tutor-portrait"><Lumi pose="hint" size={74} /></span>
              <div className="min-w-0 flex-1">
                <p className="overlay-dialog-kicker">
                  <span aria-hidden="true" className="overlay-dialog-kicker-diamond" />
                  <span className="card-tutor-kicker-classic"><Trans {...msg({ context: 'flashcard.ai.kicker', message: 'AI tutor' })} /></span>
                  <span className="card-tutor-kicker-crystal"><Trans {...msg({ context: 'flashcard.ai.kicker-lumi', message: 'Lumi · AI tutor' })} /></span>
                </p>
                <Dialog.Title className="overlay-dialog-title">
                  <Trans {...msg({ context: 'flashcard.ai.ask-about', message: 'Ask about <0>{word}</0>' })} values={{ word: card.word }} components={{ 0: <span lang={card.language || 'en'} className="card-tutor-word" /> }} />
                </Dialog.Title>
                {senseParts.length > 0 ? (
                  <p className="overlay-dialog-sub card-tutor-sense">
                    {senseParts.map((part, index) => (
                      <Fragment key={part.key}>
                        {index > 0 ? <span aria-hidden="true"> · </span> : null}
                        {part}
                      </Fragment>
                    ))}
                  </p>
                ) : null}
                <Dialog.Description id={`ai-assistant-description-${card.id}`} className="sr-only">
                  <Trans {...msg({ context: 'flashcard.ai.description', message: 'Ask questions about usage, nuances & practical examples.' })} />
                </Dialog.Description>
              </div>
              <Dialog.Close className="overlay-dialog-close" aria-label={_(msg({ id: 'flashcard.ai.close', message: 'Close AI tutor' }))}>
                <span aria-hidden="true" className="overlay-dialog-close-surface"><X /></span>
              </Dialog.Close>
            </div>

            <div className="card-tutor-content">
              <p id="card-tutor-presets-label" className="sr-only">
                <Trans {...msg({ context: 'flashcard.ai.quick-suggestions', message: 'Quick Suggestions' })} />
              </p>
              <div role="group" aria-labelledby="card-tutor-presets-label" className="card-tutor-presets">
                {PRESET_PROMPTS.map((preset, i) => (
                  <button
                    key={i}
                    type="button"
                    disabled={isLoading}
                    data-active={lastQuestion === _(preset.label.id) ? 'true' : undefined}
                    onClick={() => void askAi(preset.prompt, _(preset.label.id))}
                    className="card-tutor-preset"
                  >
                    {_(preset.label.id)}
                  </button>
                ))}
              </div>

              {(turns.length > 0 || isLoading || error) && (
                <div className="card-tutor-answers" aria-live="polite">
                  {turns.map((turn, index) => (
                    <div key={index} className="card-tutor-answer">
                      <p className="card-tutor-answer-heading">
                        <Sparkles aria-hidden="true" />
                        <span className="sr-only"><Trans {...msg({ context: 'flashcard.ai.question', message: 'Q:' })} /> </span>
                        {turn.label || turn.question}
                      </p>
                      <p className="card-tutor-answer-text">{turn.answer}</p>
                    </div>
                  ))}
                  {(isLoading || error) && <div className="card-tutor-answer">
                    <p className="card-tutor-answer-heading"><Sparkles aria-hidden="true" />{activeQuestion}</p>
                    {isLoading ? (
                      <div role="status" className="card-tutor-loading">
                        <span aria-hidden="true" className="card-tutor-spinner" />
                        <span><Trans {...msg({ context: 'flashcard.ai.formulating', message: 'AI is formulating an answer…' })} /></span>
                      </div>
                    ) : <p className="card-tutor-error">{error}</p>}
                  </div>}
                </div>
              )}

              <form onSubmit={handleCustomSubmit} className="card-tutor-ask">
                <input
                  type="text"
                  aria-label={_(msg({ id: 'flashcard.ai.question-label', message: 'Ask a question about this word' }))}
                  value={customQuery}
                  onChange={e => setCustomQuery(e.target.value)}
                  maxLength={300}
                  placeholder={i18n._(msg({ id: 'flashcard.ai.placeholder', message: 'Ask anything about “{word}”…' }).id, { word: card.word })}
                  disabled={isLoading}
                  className="card-tutor-input"
                />
                <button
                  type="submit"
                  disabled={!customQuery.trim() || isLoading}
                  className="card-tutor-send"
                  aria-label={_(msg({ id: 'flashcard.ai.send', message: 'Send question' }))}
                >
                  <span aria-hidden="true" className="card-tutor-send-surface"><ArrowRight /></span>
                </button>
              </form>
            </div>

            <div className="overlay-dialog-footer">
              <p className="overlay-dialog-note"><Trans {...msg({ context: 'flashcard.ai.usage-note', message: 'AI-generated · each question uses 1 AI request' })} /></p>
              <p className="overlay-dialog-note card-tutor-count">{customQuery.length}/300</p>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
