import { ArrowLeft, Loader2, MessageCircle, Mic, MicOff, RotateCcw, Send, Volume2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { cancelSpeech, speakText } from '../../lib/audio';
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
import {
  createBrowserVoiceInputAdapter,
  isVoiceInputEnabled,
  type VoiceInputAdapter,
  type VoiceInputErrorCode,
} from '../conversation/voiceInput';

interface TextConversationPanelProps {
  readonly cards: readonly CardData[];
  readonly ownerId?: string | null;
  readonly voiceInput?: VoiceInputAdapter;
  readonly onBack: () => void;
  readonly onClose: () => void;
}

type VoiceInputUiError = VoiceInputErrorCode | 'offline' | 'circuit-open';

const VOICE_FAILURE_LIMIT = 3;

const voiceFailureMessage = (error: VoiceInputUiError): string => {
  if (error === 'offline') return 'Voice input needs a connection. You can still type your message.';
  if (error === 'unsupported') return 'Voice input is unavailable in this browser. You can type your message instead.';
  if (error === 'denied') return 'Microphone permission was denied. You can type your message instead.';
  if (error === 'timeout') return 'No transcript was captured in time. Try again or type your message.';
  if (error === 'circuit-open') return 'Voice input is paused after repeated failures. Type your message instead.';
  return 'Voice input stopped unexpectedly. Try again or type your message.';
};

const normalizeVoiceTranscript = (value: string): string => value
  .normalize('NFKC')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 500);

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

export function TextConversationPanel({ cards, ownerId, voiceInput, onBack, onClose }: TextConversationPanelProps) {
  const validCards = useMemo(() => cards
    .filter(card => card.word.trim() && card.translation.trim())
    .slice(0, 5)
    .map(card => ({ id: card.id, word: card.word, translation: card.translation })), [cards]);
  const mission = useMemo(() => validCards.length > 0
    ? createTextConversationMission(validCards)
    : null, [validCards]);
  const [session, setSession] = useState<TextConversationSessionV1 | null>(() => (
    mission ? createTextConversationSession(mission, sessionIdentifier()) : null
  ));
  const [draft, setDraft] = useState('');
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<TextConversationFailureCodeV1 | null>(null);
  const inFlight = useRef(false);
  const ownerRef = useRef(ownerId);
  const attemptRef = useRef(0);
  const activeMission = session?.mission ?? mission;
  const latestOwnerRef = useRef(ownerId);
  latestOwnerRef.current = ownerId;
  const voiceInputEnabled = isVoiceInputEnabled();
  const voiceAdapter = useMemo(() => (
    voiceInputEnabled ? voiceInput ?? createBrowserVoiceInputAdapter() : null
  ), [voiceInput, voiceInputEnabled]);
  const [voiceState, setVoiceState] = useState<'idle' | 'listening' | 'stopping'>('idle');
  const [voiceError, setVoiceError] = useState<VoiceInputUiError | null>(null);
  const [voiceCircuitOpen, setVoiceCircuitOpen] = useState(false);
  const voiceRunRef = useRef(0);
  const voiceFailureCountRef = useRef(0);

  useEffect(() => {
    if (!voiceAdapter) return undefined;
    const subscribedOwner = ownerId;
    const unsubscribe = voiceAdapter.subscribe({
      onState: state => {
        if (latestOwnerRef.current !== subscribedOwner || voiceRunRef.current === 0) return;
        setVoiceState(state);
      },
      onTranscript: transcript => {
        if (latestOwnerRef.current !== subscribedOwner || voiceRunRef.current === 0) return;
        voiceRunRef.current = 0;
        const normalized = normalizeVoiceTranscript(transcript);
        if (!normalized) {
          setVoiceState('idle');
          setVoiceError('runtime');
          return;
        }
        voiceFailureCountRef.current = 0;
        setVoiceCircuitOpen(false);
        setVoiceError(null);
        setVoiceState('idle');
        setDraft(normalized);
      },
      onError: error => {
        if (latestOwnerRef.current !== subscribedOwner || voiceRunRef.current === 0) return;
        voiceRunRef.current = 0;
        setVoiceState('idle');
        setVoiceError(error);
        if (error === 'unsupported') return;
        voiceFailureCountRef.current += 1;
        if (voiceFailureCountRef.current >= VOICE_FAILURE_LIMIT) {
          setVoiceCircuitOpen(true);
          setVoiceError('circuit-open');
        }
      },
    });
    return () => {
      voiceRunRef.current = 0;
      voiceAdapter.stop();
      unsubscribe();
    };
  }, [ownerId, voiceAdapter]);

  useEffect(() => () => cancelSpeech(), []);

  useEffect(() => {
    if (ownerRef.current === ownerId) return;
    ownerRef.current = ownerId;
    attemptRef.current += 1;
    inFlight.current = false;
    setIsLoading(false);
    setDraft('');
    setPendingMessage(null);
    setError(null);
    setSession(mission ? createTextConversationSession(mission, sessionIdentifier()) : null);
    voiceRunRef.current = 0;
    voiceAdapter?.stop();
    setVoiceState('idle');
    setVoiceError(null);
    setVoiceCircuitOpen(false);
    voiceFailureCountRef.current = 0;
    cancelSpeech();
    if (ownerId !== undefined) onClose();
  }, [mission, onClose, ownerId, voiceAdapter]);

  const handleVoiceToggle = () => {
    if (!voiceAdapter || !session) return;
    if (voiceRunRef.current !== 0) {
      voiceRunRef.current = 0;
      voiceAdapter.stop();
      setVoiceState('idle');
      return;
    }
    if (voiceCircuitOpen || isLoading || session.status !== 'active') return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setVoiceError('offline');
      return;
    }
    voiceRunRef.current += 1;
    setVoiceError(null);
    if (!voiceAdapter.start()) voiceRunRef.current = 0;
  };

  const submit = async (sessionToUse: TextConversationSessionV1, message: string) => {
    if (inFlight.current) return;
    const attemptOwnerId = ownerId;
    const attempt = attemptRef.current + 1;
    attemptRef.current = attempt;
    const isCurrent = () => attemptRef.current === attempt && ownerRef.current === attemptOwnerId;
    inFlight.current = true;
    setIsLoading(true);
    setError(null);
    setPendingMessage(message);
    try {
      const request = buildTextConversationRequest(sessionToUse, message, {
        isOffline: typeof navigator !== 'undefined' && navigator.onLine === false,
      });
      const response = await sendTextConversationTurn(request, attemptOwnerId);
      if (!isCurrent()) return;
      const applied = applyTextConversationTurn(sessionToUse, request.userMessage, response);
      setSession(applied.state);
      setDraft('');
      setPendingMessage(null);
    } catch (cause) {
      if (!isCurrent()) return;
      const code = classifyTextConversationError(cause);
      setError(code);
      setSession(current => {
        if (!current) return current;
        return code === 'session-complete'
          ? { ...current, status: 'completed', lastError: null }
          : failTextConversationTurn(current, code);
      });
    } finally {
      if (isCurrent()) {
        inFlight.current = false;
        setIsLoading(false);
      }
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isLoading || !session || session.status !== 'active') return;
    const message = draft.trim();
    if (!message) return;
    void submit(session, message);
  };

  const handleRetry = () => {
    if (!pendingMessage || isLoading || !session) return;
    const activeSession = retryTextConversation(session);
    setSession(activeSession);
    void submit(activeSession, pendingMessage);
  };

  if (!activeMission || !session) {
    return (
      <section
        className="max-h-[calc(100dvh-2rem)] w-full overflow-y-auto rounded-[24px] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-5 text-[var(--sf-text)] shadow-xl outline-none sm:p-6"
        aria-labelledby="text-conversation-heading"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="text-conversation-heading" className="text-lg font-black sm:text-xl">Text practice mission</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close text practice"
            className="flex size-10 items-center justify-center rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-text)]"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <p className="mt-4 text-sm text-[var(--sf-text-muted)]" role="status">No vocabulary cards are available for this mission.</p>
      </section>
    );
  }

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
              {message.role === 'assistant' && (
                <button
                  type="button"
                  onClick={() => speakText(message.text)}
                  className="mt-2 inline-flex min-h-8 items-center gap-1 rounded-lg border border-current/20 px-2 text-[11px] font-bold opacity-80 hover:opacity-100"
                  aria-label="Read reply aloud"
                >
                  <Volume2 size={12} aria-hidden="true" /> Read reply
                </button>
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
          <div className="min-w-0 flex-1 space-y-2">
            <label className="sr-only" htmlFor="text-conversation-message">Your message</label>
            <textarea
              id="text-conversation-message"
              value={draft}
              onChange={event => setDraft(event.target.value)}
              placeholder="Write your reply…"
              maxLength={500}
              rows={2}
              disabled={isLoading || session.status !== 'active'}
              className="min-h-12 w-full resize-none rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-3 py-2.5 text-sm outline-none focus:border-[var(--sf-brand)] disabled:opacity-60"
            />
            {voiceAdapter && (
              <div className="space-y-1">
                <button
                  type="button"
                  onClick={handleVoiceToggle}
                  disabled={!voiceAdapter.supported || voiceCircuitOpen || isLoading || session.status !== 'active'}
                  aria-pressed={voiceState === 'listening'}
                  aria-label={voiceState === 'listening' ? 'Stop voice input' : 'Start voice input'}
                  aria-describedby="voice-input-help"
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-3 text-xs font-bold text-[var(--sf-text)] hover:border-[var(--sf-brand)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {voiceState === 'listening' ? <MicOff size={14} aria-hidden="true" /> : <Mic size={14} aria-hidden="true" />}
                  {voiceState === 'listening' ? 'Stop voice input' : 'Start voice input'}
                </button>
                <p id="voice-input-help" className="text-[11px] text-[var(--sf-text-muted)]" role="status">
                  Voice input (transcript only). SonFlash does not store a recording; your browser's speech service may process audio. Typing is always available.
                </p>
                {voiceError && (
                  <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-200" role="alert">
                    {voiceFailureMessage(voiceError)}
                  </p>
                )}
              </div>
            )}
          </div>
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
