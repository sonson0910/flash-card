import * as Dialog from '@radix-ui/react-dialog';
import { i18n, type MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Check, Loader2, Sparkles, Volume2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { translateText } from '../../lib/gemini';
import { playWordAudio, type WordAudioPlayback } from '../../lib/audio';
import { getProtectedFunctionUserMessage, ProtectedFunctionError } from '../../lib/protectedFunctionsCapability';
import type { CardData } from '../../types/card';

interface AiDialogueModalProps {
  cards: CardData[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface DialogueTurn {
  speaker: string;
  en: string;
  vi: string;
}

interface DialogueResult {
  title: string;
  context: string;
  turns: DialogueTurn[];
}

const translate = (descriptor: MessageDescriptor, values?: Record<string, unknown>) =>
  i18n.locale ? i18n._(descriptor.id, values) : descriptor.message ?? descriptor.id;

export function dialogueFailureMessage(error: unknown): string {
  if (error instanceof ProtectedFunctionError) {
    if (error.reason === 'service-daily-cap') return translate(msg({ id: 'library.dialogue.error.service-daily-cap', message: 'AI is paused because today’s shared limit is exhausted. Try again after 00:00 Vietnam time.' }));
    if (error.reason === 'account-daily-spend') return translate(msg({ id: 'library.dialogue.error.account-daily-spend', message: 'You have reached your AI spending limit for today. Try again after 00:00 Vietnam time.' }));
    if (error.reason === 'ai-card-quota') return translate(msg({ id: 'library.dialogue.error.ai-card-quota', message: 'You have used your AI card allowance for this period. See Pro or wait for the next period; review and manual cards still work.' }));
    if (error.reason === 'ai-daily-allowance') return translate(msg({ id: 'library.dialogue.error.ai-daily-allowance', message: 'You have used today’s extra AI allowance. Try again after 00:00 Vietnam time.' }));
    if (error.reason === 'operation-in-flight') return translate(msg({ id: 'library.dialogue.error.operation-in-flight', message: 'AI is still writing this dialogue. Try again in a few seconds.' }));
    if (error.kind === 'quota') return translate(msg({ id: 'library.dialogue.error.quota', message: 'AI usage limit reached. Try again when your allowance resets.' }));
  }
  return getProtectedFunctionUserMessage(error)
    ?? translate(msg({ id: 'library.dialogue.error.default', message: 'Unable to create a dialogue right now. Please try again.' }));
}

export function AiDialogueContent({
  cards,
  onClose,
}: {
  cards: CardData[];
  onClose: () => void;
}) {
  const [selectedWordIds, setSelectedWordIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [dialogue, setDialogue] = useState<DialogueResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const audioPlaybackRef = useRef<WordAudioPlayback | null>(null);

  useEffect(() => () => audioPlaybackRef.current?.cancel(), []);

  const playLine = (line: string) => {
    audioPlaybackRef.current?.cancel();
    audioPlaybackRef.current = playWordAudio(line, null);
  };

  const close = () => {
    audioPlaybackRef.current?.cancel();
    onClose();
  };

  const availableCards = cards.filter(c => Boolean(c.word)).slice(0, 30);

  const toggleWordSelection = (id: string) => {
    const next = new Set(selectedWordIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      if (next.size >= 5) return;
      next.add(id);
    }
    setSelectedWordIds(next);
  };

  const selectRandomWords = () => {
    const shuffled = [...availableCards].sort(() => Math.random() - 0.5);
    const chosen = shuffled.slice(0, 4).map(c => c.id);
    setSelectedWordIds(new Set(chosen));
  };

  const handleGenerate = async () => {
    const chosenCards = cards.filter(c => selectedWordIds.has(c.id));
    const wordsList = chosenCards.length > 0
      ? chosenCards.map(c => `"${c.word}" (${c.translation})`).join(', ')
      : availableCards.slice(0, 4).map(c => `"${c.word}" (${c.translation})`).join(', ');

    setIsLoading(true);
    setError(null);
    setDialogue(null);

    try {
      const prompt = `You are a professional English dialogue writer. Write a short, realistic conversation (4–6 turns) between Alex and Sarah that naturally uses these vocabulary items: ${wordsList}.
Return ONLY valid JSON in this structure (without markdown):
{
  "title": "A short context title (for example, At a café / A job interview)",
  "context": "A one-sentence context description",
  "turns": [
    { "speaker": "Alex", "en": "Alex's English line", "vi": "Vietnamese translation" },
    { "speaker": "Sarah", "en": "Sarah's English line", "vi": "Vietnamese translation" }
  ]
}`;

      const rawResult = await translateText(prompt);
      if (!rawResult) throw new Error('No content returned');

      // Extract JSON cleanly
      const jsonStart = rawResult.indexOf('{');
      const jsonEnd = rawResult.lastIndexOf('}');
      if (jsonStart === -1 || jsonEnd === -1) throw new Error('Invalid JSON format');

      const parsed: DialogueResult = JSON.parse(rawResult.slice(jsonStart, jsonEnd + 1));
      if (!Array.isArray(parsed?.turns)) throw new Error('Invalid dialogue structure');
      setDialogue(parsed);
    } catch (error) {
      setError(error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="max-h-[calc(100dvh-2rem)] w-full overflow-y-auto rounded-[28px] border border-[var(--sf-border)] bg-[var(--sf-surface)] text-[var(--sf-text)] shadow-2xl outline-none"
    >
      <header className="flex items-start justify-between gap-4 border-b border-[var(--sf-border)] px-5 py-5 sm:px-7">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--sf-brand-text)]">
            <Sparkles size={13} aria-hidden="true" />
            {translate(msg({ id: 'library.dialogue.eyebrow', message: 'AI dialogue' }))}
          </p>
          <Dialog.Title className="mt-1 font-display text-3xl font-semibold tracking-tight text-[var(--sf-text)]">
            {translate(msg({ id: 'library.dialogue.title', message: 'Practice in context' }))}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm leading-6 text-[var(--sf-text-muted)]">
            {translate(msg({ id: 'library.dialogue.description', message: 'Build a short conversation with words from your library.' }))}
          </Dialog.Description>
        </div>
        <button
          type="button"
          onClick={close}
          className="flex size-9 shrink-0 items-center justify-center rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-text-muted)] transition-colors hover:border-[var(--sf-brand)] hover:text-[var(--sf-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)]"
          aria-label={translate(msg({ id: 'library.close', message: 'Close' }))}
        >
          <X size={16} />
        </button>
      </header>

      {!dialogue && (
        <div className="space-y-4 px-5 py-5 sm:px-7">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-[var(--sf-text)]">
              {translate(msg({ id: 'library.dialogue.select-words', message: 'Choose up to 5 words ({selected, number}/5)' }), { selected: selectedWordIds.size })}
            </p>
            <button
              type="button"
              onClick={selectRandomWords}
              className="text-xs font-semibold text-[var(--sf-brand-text)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)]"
            >
              {translate(msg({ id: 'library.dialogue.random', message: 'Choose for me' }))}
            </button>
          </div>

          <div className="flex max-h-44 flex-wrap gap-2 overflow-y-auto pr-1">
            {availableCards.map(c => {
              const isSelected = selectedWordIds.has(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleWordSelection(c.id)}
                    aria-pressed={isSelected}
                    className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)] ${
                      isSelected
                      ? 'border-[var(--sf-brand)] bg-[color-mix(in_srgb,var(--sf-brand)_10%,var(--sf-surface))] text-[var(--sf-brand-text)]'
                      : 'border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-text)] hover:border-[var(--sf-brand)]'
                  }`}
                >
                  {isSelected && <Check size={13} className="text-purple-500" />}
                  <span lang={c.language || 'en'}>{c.word}</span>
                </button>
              );
            })}
          </div>

          {error !== null && (
            <p role="alert" className="rounded-[14px] border border-rose-400/30 bg-rose-500/10 p-3 text-sm font-medium text-rose-700 dark:text-rose-200">
              {dialogueFailureMessage(error)}
            </p>
          )}

          <button
            type="button"
            onClick={handleGenerate}
            disabled={isLoading}
            className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--sf-brand)] px-5 text-sm font-semibold text-[var(--sf-on-brand)] shadow-[var(--sf-shadow)] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)] disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                <span>{translate(msg({ id: 'library.dialogue.loading', message: 'AI is writing the dialogue…' }))}</span>
              </>
            ) : (
              <>
                <Sparkles size={18} />
                <span>{translate(msg({ id: 'library.dialogue.submit', message: 'Create dialogue' }))}</span>
              </>
            )}
          </button>
        </div>
      )}

      {dialogue && (
        <div className="space-y-4 px-5 py-5 sm:px-7">
          <div className="rounded-[14px] border border-[var(--sf-border)] bg-[color-mix(in_srgb,var(--sf-brand)_8%,var(--sf-surface))] p-4">
            <h3 lang="en" className="font-display text-xl font-semibold text-[var(--sf-text)]">
              {dialogue.title}
            </h3>
            <p lang="en" className="mt-1 text-xs text-[var(--sf-text-muted)]">
              {dialogue.context}
            </p>
          </div>

          <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
            {dialogue.turns.map((turn, i) => (
              <div
                key={i}
                className="flex flex-col gap-1 rounded-[14px] border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-4"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-black uppercase tracking-wider text-[var(--sf-brand-text)]">
                    {turn.speaker}
                  </span>
                  <button
                    type="button"
                    onClick={() => playLine(turn.en)}
                    className="flex size-8 items-center justify-center rounded-lg border border-[var(--sf-border)] bg-[var(--sf-surface)] text-[var(--sf-text-muted)] hover:text-[var(--sf-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)]"
                    aria-label={translate(msg({ id: 'library.dialogue.listen', message: 'Listen to {speaker}’s line' }), { speaker: turn.speaker })}
                  >
                    <Volume2 size={13} />
                  </button>
                </div>
                <p lang="en" className="text-sm font-semibold text-[var(--sf-text)]">
                  {turn.en}
                </p>
                <p lang="vi" className="text-xs text-[var(--sf-text-muted)]">
                  {turn.vi}
                </p>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setDialogue(null)}
            className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-sm font-semibold text-[var(--sf-text)] hover:border-[var(--sf-brand)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)]"
          >
            <span>{translate(msg({ id: 'library.dialogue.reset', message: 'Create another dialogue' }))}</span>
          </button>
        </div>
      )}
    </div>
  );
}

export function AiDialogueModal({ cards, open, onOpenChange }: AiDialogueModalProps) {
  if (!open) return null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm" />
        <Dialog.Content className="fixed inset-x-4 top-1/2 z-50 mx-auto w-auto max-w-2xl -translate-y-1/2 focus:outline-none sm:inset-x-6">
          <AiDialogueContent
            cards={cards}
            onClose={() => onOpenChange(false)}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
