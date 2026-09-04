import { ArrowLeft, Loader2, MessageCircle, RotateCcw, Send, X } from 'lucide-react';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { sendTextConversationTurn } from '../../lib/gemini';
import type { CardData } from '../../types/card';
import {
  applyTextConversationTurn,
  buildTextConversationRequest,
  classifyTextConversationError,
  createTextConversationMission,
  createTextConversationSession,
  failTextConversationTurn,
  retryTextConversation,
  type TextConversationFailureCodeV1,
  type TextConversationSessionV1,
} from '../conversation/textConversationModel';

interface TextConversationPanelProps {
  readonly cards: readonly CardData[];
  readonly onBack: () => void;
  readonly onClose: () => void;
}

const failureMessage = (code: TextConversationFailureCodeV1): string => {
  if (code === 'offline-unavailable') return 'Text practice needs a connection. Reconnect, then try again.';
  if (code === 'authentication-required') return 'Sign in again to continue this text mission.';
  if (code === 'quota-exceeded') return 'Text practice has reached its usage limit. Try again later.';
  if (code === 'network-error') return 'The conversation could not reach the service. Check your connection and retry.';
  if (code === 'invalid-response') return 'The conversation returned an invalid response. Nothing was added; retry safely.';
  if (code === 'session-complete') return 'This mission is already complete.';
  return 'The conversation is temporarily unavailable. Please retry.';
};

const sessionIdentifier = (): string => (
  typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : 'text-session'
);

export function TextConversationPanel({ cards, onBack, onClose }: TextConversationPanelProps) {
  const mission = useMemo(() => createTextConversationMission(
    cards
      .filter(card => card.word.trim() && card.translation.trim())
      .slice(0, 5)
      .map(card => ({ id: card.id, word: card.word, translation: card.translation })),
  ), [cards]);
  const [session, setSession] = useState<TextConversationSessionV1>(() => (
    createTextConversationSession(mission, sessionIdentifier())
  ));
  const [draft, setDraft] = useState('');
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<TextConversationFailureCodeV1 | null>(null);
  const inFlight = useRef(false);
  const activeMission = session.mission;

  const submit = async (sessionToUse: TextConversationSessionV1, message: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setIsLoading(true);
    setError(null);
    setPendingMessage(message);
    try {
      const request = buildTextConversationRequest(sessionToUse, message, {
        isOffline: typeof navigator !== 'undefined' && navigator.onLine === false,
      });
      const response = await sendTextConversationTurn(request);
      const applied = applyTextConversationTurn(sessionToUse, request.userMessage, response);
      setSession(applied.state);
      setDraft('');
      setPendingMessage(null);
    } catch (cause) {
      const code = classifyTextConversationError(cause);
      setError(code);
      setSession(current => code === 'session-complete'
        ? { ...current, status: 'completed', lastError: null }
        : failTextConversationTurn(current, code));
    } finally {
      inFlight.current = false;
      setIsLoading(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isLoading || session.status !== 'active') return;
    const message = draft.trim();
    if (!message) return;
    void submit(session, message);
  };

  const handleRetry = () => {
    if (!pendingMessage || isLoading) return;
    const activeSession = retryTextConversation(session);
    setSession(activeSession);
    void submit(activeSession, pendingMessage);
  };

  return (
    <section
      className="max-h-[calc(100dvh-2rem)] w-full overflow-y-auto rounded-[24px] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-5 text-[var(--sf-text)] shadow-xl outline-none sm:p-6"
      aria-labelledby="text-conversation-heading"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--sf-brand)] text-[var(--sf-on-brand)]">
            <MessageCircle size={20} aria-hidden="true" />
          </div>
          <div>
            <h2 id="text-conversation-heading" className="text-lg font-black sm:text-xl">
              Text practice mission
            </h2>
            <p className="mt-1 text-xs text-[var(--sf-text-muted)]">{activeMission.goal}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="flex min-h-10 items-center gap-1.5 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-3 text-xs font-bold text-[var(--sf-text)] hover:border-[var(--sf-brand)]"
          >
            <ArrowLeft size={14} aria-hidden="true" />
            Back
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close text practice"
            className="flex size-10 items-center justify-center rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-text)] hover:border-[var(--sf-brand)]"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5" aria-label="Mission vocabulary">
        {activeMission.cards.map(card => (
          <span key={card.id} className="rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-2.5 py-1 text-[11px] font-bold">
            {card.word}
          </span>
        ))}
      </div>

      <div
        className="mt-4 max-h-72 space-y-2 overflow-y-auto rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-3"
        role="log"
        aria-label="Text conversation"
        aria-live="polite"
      >
        {session.messages.length === 0 && (
          <p className="p-3 text-sm text-[var(--sf-text-muted)]">
            Start the mission with a short greeting or ask about one of the target words.
          </p>
        )}
        {session.messages.map((message, index) => (
          <div key={`${message.role}-${index}`} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm ${message.role === 'user' ? 'bg-[var(--sf-brand)] text-[var(--sf-on-brand)]' : 'border border-[var(--sf-border)] bg-[var(--sf-surface)]'}`}>
              <p className="font-medium">{message.text}</p>
              {message.translation && (
                <p className="mt-1 text-xs opacity-75">{message.translation}</p>
              )}
              {message.correction && (
                <div className="mt-2 border-t border-current/20 pt-2 text-xs">
                  <p><span className="font-bold">Try:</span> {message.correction.corrected}</p>
                  <p className="mt-0.5 opacity-75">{message.correction.explanation}</p>
                </div>
              )}
              {message.nextPrompt && (
                <p className="mt-2 border-t border-current/20 pt-2 text-xs font-semibold opacity-75">
                  Next: {message.nextPrompt}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-2 text-right text-[11px] font-semibold text-[var(--sf-text-muted)]" aria-label="Mission turn count">
        {Math.min(session.turn - 1, 6)}/6 turns
      </p>

      {error && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-xs font-semibold text-rose-700 dark:text-rose-200" role="alert">
          <span>{failureMessage(error)}</span>
          {pendingMessage && error !== 'session-complete' && (
            <button
              type="button"
              onClick={handleRetry}
              disabled={isLoading}
              className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-lg border border-current px-2.5 text-[11px] font-bold disabled:opacity-50"
            >
              <RotateCcw size={12} aria-hidden="true" /> Retry
            </button>
          )}
        </div>
      )}

      {session.status === 'completed' ? (
        <p className="mt-4 rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3 text-center text-sm font-bold text-emerald-700 dark:text-emerald-200" role="status">
          Mission complete. Your text practice stayed separate from review ratings.
        </p>
      ) : (
        <form className="mt-4 flex items-end gap-2" onSubmit={handleSubmit}>
          <label className="sr-only" htmlFor="text-conversation-message">Your message</label>
          <textarea
            id="text-conversation-message"
            value={draft}
            onChange={event => setDraft(event.target.value)}
            placeholder="Write your reply…"
            maxLength={500}
            rows={2}
            disabled={isLoading || session.status !== 'active'}
            className="min-h-12 flex-1 resize-none rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-3 py-2.5 text-sm outline-none focus:border-[var(--sf-brand)] disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={isLoading || session.status !== 'active' || !draft.trim()}
            aria-label="Send message"
            className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-[var(--sf-brand)] text-[var(--sf-on-brand)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <Send size={18} aria-hidden="true" />}
          </button>
        </form>
      )}
    </section>
  );
}
