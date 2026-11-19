import { useEffect, useId, useMemo, useState } from 'react';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { IeltsBandPicker } from './IeltsBandPicker';
import { LatestExamScoreError, readLatestExamScore, saveLatestExamScore, type LatestExamScoreErrorCode } from './latestExamScore';
import { defaultLatestExamScorePorts, type LatestExamScorePorts } from './latestExamScorePorts';
import './latest-exam-score-editor.css';

export interface LatestExamScoreEditorProps {
  readonly ownerId: string;
  readonly courseId: string;
  /** An IELTS goal of that course. */
  readonly goalId: string;
  /** The stored score when the caller already has it; otherwise the editor reads it once. */
  readonly initialScore?: string | null;
  /** Called with the canonical score the server stored, or null after clearing. */
  readonly onSaved?: (latestScore: string | null) => void;
  /** Firestore and callable ports; the app's own instances by default. */
  readonly ports?: LatestExamScorePorts;
}

export type StoredLatestScore =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly score: string | null }
  | { readonly status: 'unreadable' };

export type LatestScoreSaving =
  | { readonly status: 'idle' }
  | { readonly status: 'pending'; readonly clearing: boolean }
  | { readonly status: 'saved'; readonly score: string | null }
  | { readonly status: 'failed'; readonly code: LatestExamScoreErrorCode };

export interface LatestExamScoreEditorState {
  readonly stored: StoredLatestScore;
  /** The band chosen in the picker; null until one is chosen. */
  readonly selected: string | null;
  readonly saving: LatestScoreSaving;
}

export interface LatestExamScoreEditorController extends LatestExamScoreEditorState {
  readonly select: (band: string) => void;
  readonly save: () => Promise<void>;
  readonly clear: () => Promise<void>;
}

/** Loads, saves and clears the latest score of one goal through the callable. */
export function useLatestExamScoreEditor({ ownerId, courseId, goalId, initialScore, onSaved, ports }: LatestExamScoreEditorProps): LatestExamScoreEditorController {
  const resolvedPorts = useMemo(() => ports ?? defaultLatestExamScorePorts(), [ports]);
  const [stored, setStored] = useState<StoredLatestScore>(initialScore === undefined ? { status: 'loading' } : { status: 'ready', score: initialScore });
  const [selected, setSelected] = useState<string | null>(initialScore ?? null);
  const [saving, setSaving] = useState<LatestScoreSaving>({ status: 'idle' });

  useEffect(() => {
    if (initialScore !== undefined) return undefined;
    const database = resolvedPorts.database;
    if (!database) {
      setStored({ status: 'unreadable' });
      return undefined;
    }
    let cancelled = false;
    readLatestExamScore(database, { ownerId, courseId, goalId }).then(score => {
      if (cancelled) return;
      setStored({ status: 'ready', score });
      setSelected(score);
    }, () => {
      if (!cancelled) setStored({ status: 'unreadable' });
    });
    return () => { cancelled = true; };
  }, [initialScore, resolvedPorts, ownerId, courseId, goalId]);

  const write = async (latestScore: string | null) => {
    setSaving({ status: 'pending', clearing: latestScore === null });
    try {
      const score = await saveLatestExamScore(resolvedPorts.call, { ownerId, courseId, goalId, latestScore });
      setStored({ status: 'ready', score });
      setSelected(score);
      setSaving({ status: 'saved', score });
      onSaved?.(score);
    } catch (error) {
      setSaving({ status: 'failed', code: error instanceof LatestExamScoreError ? error.code : 'failed' });
    }
  };

  return {
    stored,
    selected,
    saving,
    select: band => {
      setSelected(band);
      setSaving({ status: 'idle' });
    },
    save: async () => {
      if (selected !== null && saving.status !== 'pending') await write(selected);
    },
    clear: async () => {
      if (saving.status !== 'pending') await write(null);
    },
  };
}

export interface LatestExamScoreEditorViewProps {
  readonly editor: LatestExamScoreEditorState;
  readonly onSelect: (band: string) => void;
  readonly onSave: () => void;
  readonly onClear: () => void;
}

/** The picker, save and clear buttons, and the pending, saved and error messages. */
export function LatestExamScoreEditorView({ editor, onSelect, onSave, onClear }: LatestExamScoreEditorViewProps) {
  const { _ } = useLingui();
  const hintId = useId();
  const { stored, selected, saving } = editor;
  const storedScore = stored.status === 'ready' ? stored.score : null;
  const pending = saving.status === 'pending';

  const errorText = saving.status !== 'failed' ? null
    : saving.code === 'goal-missing'
      ? _(msg({ id: 'latest-score-editor.error.goal-missing', message: 'This goal no longer exists, so the score was not saved.' }))
      : saving.code === 'rate-limited'
        ? _(msg({ id: 'latest-score-editor.error.rate-limited', message: 'Too many changes at once. Wait a moment and try again.' }))
        : saving.code === 'invalid'
          ? _(msg({ id: 'latest-score-editor.error.invalid', message: 'Choose a band from 4.0 to 9.0.' }))
          : _(msg({ id: 'latest-score-editor.error.failed', message: 'Your score could not be saved. Check your connection and try again.' }));

  return (
    <div className="latest-score-editor" aria-busy={stored.status === 'loading' || pending}>
      {stored.status === 'loading' ? (
        <p className="latest-score-editor__status" role="status">
          {_(msg({ id: 'latest-score-editor.loading', message: 'Loading your latest score…' }))}
        </p>
      ) : (
        <>
          <IeltsBandPicker
            value={selected}
            onChange={onSelect}
            legend={_(msg({ id: 'latest-score-editor.legend', message: 'Your latest IELTS score' }))}
            disabled={pending}
          />
          <p id={hintId} className="latest-score-editor__hint">
            {_(msg({ id: 'latest-score-editor.hint', message: 'Optional. Choose the overall band from your most recent IELTS test.' }))}
          </p>
          {stored.status === 'unreadable' && (
            <p className="latest-score-editor__notice">
              {_(msg({ id: 'latest-score-editor.unreadable', message: 'Your saved score could not be loaded. Saving a new one replaces it.' }))}
            </p>
          )}
          <div className="latest-score-editor__actions">
            <button
              type="button"
              className="latest-score-editor__save"
              aria-describedby={hintId}
              disabled={pending || selected === null || selected === storedScore}
              onClick={onSave}
            >
              {pending && !saving.clearing
                ? _(msg({ id: 'latest-score-editor.saving', message: 'Saving…' }))
                : _(msg({ id: 'latest-score-editor.save', message: 'Save score' }))}
            </button>
            {storedScore !== null && (
              <button type="button" className="latest-score-editor__clear" disabled={pending} onClick={onClear}>
                {pending && saving.clearing
                  ? _(msg({ id: 'latest-score-editor.clearing', message: 'Clearing…' }))
                  : _(msg({ id: 'latest-score-editor.clear', message: 'Clear score' }))}
              </button>
            )}
          </div>
          <p className="latest-score-editor__status" role="status">
            {saving.status === 'saved' && (saving.score === null
              ? _(msg({ id: 'latest-score-editor.cleared', message: 'Score cleared.' }))
              : _({ ...msg({ id: 'latest-score-editor.saved', message: 'Score saved: {score}.' }), values: { score: saving.score } }))}
          </p>
          {errorText && <p className="latest-score-editor__error" role="alert">{errorText}</p>}
        </>
      )}
    </div>
  );
}

/** Lets the learner add, change or clear the latest IELTS score they report for a goal. */
export function LatestExamScoreEditor(props: LatestExamScoreEditorProps) {
  const editor = useLatestExamScoreEditor(props);
  return (
    <LatestExamScoreEditorView
      editor={editor}
      onSelect={editor.select}
      onSave={() => { void editor.save(); }}
      onClear={() => { void editor.clear(); }}
    />
  );
}
