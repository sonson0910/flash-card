import * as Dialog from '@radix-ui/react-dialog';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { Bot, Loader2, Send, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import type { CardData } from '../../types/card';
import { currentOwnerId, observeOwner } from '../../features/session/ownerSessionPort';
import { askCardTutor, type CardTutorTurn } from '../../lib/gemini';
import { ProtectedFunctionError } from '../../lib/protectedFunctionsCapability';

interface CardAiAssistantModalProps {
  card: CardData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restoreFocusRef?: RefObject<Pick<HTMLElement, 'focus'> | null>;
}

const PRESET_PROMPTS = [
  {
    label: msg({ id: 'flashcard.ai.work-examples', message: '💼 3 Work examples' }),
    prompt: 'Give me three realistic work examples for this word.',
  },
  {
    label: msg({ id: 'flashcard.ai.synonym-nuances', message: '🔍 Synonym nuances' }),
    prompt: 'How does this word differ from its closest synonyms?',
  },
  {
    label: msg({ id: 'flashcard.ai.idioms-collocations', message: '🗣️ Natural idioms & collocations' }),
    prompt: 'Show natural collocations and one example for each.',
  },
  {
    label: msg({ id: 'flashcard.ai.explain-meaning', message: '📖 Explain this meaning' }),
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

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[110] bg-slate-950/75 backdrop-blur-xs" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[111] max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[32px] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-6 text-[var(--sf-text)] shadow-2xl outline-none sm:p-7"
          aria-describedby={`ai-assistant-description-${card.id}`}
          onCloseAutoFocus={event => {
            event.preventDefault();
            restoreFocusRef?.current?.focus({ preventScroll: true });
          }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-2xl bg-cyan-500/15 text-cyan-600 dark:text-cyan-400">
                <Bot size={22} />
              </div>
              <div>
                <Dialog.Title className="text-balance text-lg font-black sm:text-xl">
                  <Trans {...msg({ context: 'flashcard.ai.tutor-title', message: 'AI Tutor' })} /> · <span lang={card.language || 'en'} className="text-[var(--sf-brand-text)]">{card.word}</span>
                </Dialog.Title>
                <Dialog.Description
                  id={`ai-assistant-description-${card.id}`}
                  className="mt-0.5 text-xs text-[var(--sf-text-muted)]"
                >
                  <Trans {...msg({ context: 'flashcard.ai.description', message: 'Ask questions about usage, nuances & practical examples.' })} />
                </Dialog.Description>
                <p className="mt-1 text-[11px] font-semibold text-[var(--sf-text-muted)]">
                  {(card.language || 'en').toUpperCase()} → {(card.translationLanguage || 'vi').toUpperCase()}
                </p>
              </div>
            </div>
            <Dialog.Close
              className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-text)] transition-colors hover:border-[var(--sf-brand)]"
              aria-label={_(msg({ id: 'flashcard.ai.close', message: 'Close AI tutor' }))}
            >
              <X size={18} />
            </Dialog.Close>
          </div>

          <div className="mt-5 space-y-4">
            <div>
              <p className="mb-2 text-xs font-bold text-[var(--sf-text-muted)] uppercase tracking-wider">
                <Trans {...msg({ context: 'flashcard.ai.quick-suggestions', message: 'Quick Suggestions' })} />
              </p>
              <div className="flex flex-wrap gap-2">
                {PRESET_PROMPTS.map((preset, i) => (
                  <button
                    key={i}
                    type="button"
                    disabled={isLoading}
                    onClick={() => void askAi(preset.prompt, _(preset.label.id))}
                    className="flex items-center gap-1.5 rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-3.5 py-2 text-xs font-semibold text-[var(--sf-text)] transition-colors hover:border-cyan-400 hover:text-cyan-600 dark:hover:text-cyan-300 disabled:opacity-50"
                  >
                    <Sparkles size={13} className="text-cyan-500" />
                    <span>{_(preset.label.id)}</span>
                  </button>
                ))}
              </div>
            </div>

            {(turns.length > 0 || isLoading || error) && (
              <div className="mt-4 max-h-72 space-y-3 overflow-y-auto" aria-live="polite">
                {turns.map((turn, index) => (
                  <div key={index} className="rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-4 text-sm">
                    <p className="mb-2.5 flex items-center gap-1.5 border-b border-[var(--sf-border)] pb-2 text-xs font-bold text-cyan-600 dark:text-cyan-300">
                      <span><Trans {...msg({ context: 'flashcard.ai.question', message: 'Q:' })} /></span> {turn.label || turn.question}
                    </p>
                    <p className="whitespace-pre-line text-xs leading-relaxed sm:text-sm">{turn.answer}</p>
                  </div>
                ))}
                {(isLoading || error) && <div className="rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-4 text-sm">
                  <p className="mb-2.5 border-b border-[var(--sf-border)] pb-2 text-xs font-bold text-cyan-600 dark:text-cyan-300">{activeQuestion}</p>
                  {isLoading ? (
                  <div className="flex items-center gap-2 py-3 text-xs font-bold text-[var(--sf-text-muted)]">
                    <Loader2 size={16} className="animate-spin text-[var(--sf-brand)]" />
                    <span><Trans {...msg({ context: 'flashcard.ai.formulating', message: 'AI is formulating an answer…' })} /></span>
                  </div>
                  ) : <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">{error}</p>}
                </div>}
              </div>
            )}

            {/* Custom Query Input */}
            <form onSubmit={handleCustomSubmit} className="mt-4 flex gap-2">
              <input
                type="text"
                aria-label={_(msg({ id: 'flashcard.ai.question-label', message: 'Ask a question about this word' }))}
                value={customQuery}
                onChange={e => setCustomQuery(e.target.value)}
                maxLength={300}
                placeholder={i18n._(msg({ id: 'flashcard.ai.placeholder', message: 'Ask anything about “{word}”…' }).id, { word: card.word })}
                disabled={isLoading}
                className="min-h-11 flex-1 rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface)] px-4 text-xs text-[var(--sf-text)] placeholder:text-[var(--sf-text-muted)] focus:border-[var(--sf-brand)] focus:outline-none"
              />
              <button
                type="submit"
                disabled={!customQuery.trim() || isLoading}
                className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--sf-brand)] font-extrabold text-[var(--sf-on-brand)] shadow-md shadow-sky-600/20 transition-all hover:brightness-110 active:scale-95 disabled:opacity-50 cursor-pointer"
                aria-label={_(msg({ id: 'flashcard.ai.send', message: 'Send question' }))}
              >
                <Send size={16} />
              </button>
            </form>
            <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--sf-text-muted)]">
              <span><Trans {...msg({ context: 'flashcard.ai.usage-note', message: 'AI-generated · each question uses 1 AI request' })} /></span>
              <span>{customQuery.length}/300</span>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
