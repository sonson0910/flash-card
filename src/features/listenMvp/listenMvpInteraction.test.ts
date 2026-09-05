import { describe, expect, it, vi } from 'vitest';
import {
  createListenMvpAnswerReporter,
  createListenMvpEvidence,
  createListenMvpInteractionState,
  reduceListenMvpInteractionState,
  replayListenAudio,
  runListenSave,
} from './listenMvpInteraction';
import { LISTEN_MVP_PILOT_LESSONS } from './listenMvpPilot';

const chunk = { id: 'book-a-room' } as Parameters<typeof runListenSave>[0];

describe('Listen MVP interaction model', () => {
  it('reports each selected answer once and resets that dedupe for a new lesson', async () => {
    const lesson = LISTEN_MVP_PILOT_LESSONS[0];
    if (!lesson) throw new Error('pilot lesson missing');
    const onEvidence = vi.fn();
    const reporter = createListenMvpAnswerReporter(lesson, onEvidence);

    expect(reporter.report('wrong')).toBe(true);
    expect(reporter.report('wrong')).toBe(false);
    expect(reporter.report(lesson.comprehension.answer)).toBe(true);
    await Promise.resolve();
    expect(onEvidence).toHaveBeenCalledTimes(2);
    expect(onEvidence).toHaveBeenNthCalledWith(1, expect.objectContaining({
      source: 'listening', skill: 'listening', score: 0,
    }));
    expect(onEvidence).toHaveBeenNthCalledWith(2, expect.objectContaining({
      source: 'listening', skill: 'listening', score: 1,
    }));

    reporter.reset();
    expect(reporter.report('wrong')).toBe(true);
    expect(onEvidence).toHaveBeenCalledTimes(3);
    expect(createListenMvpEvidence(lesson, 'wrong', '2026-09-05T00:00:00.000Z').id)
      .toContain('listen-break-the-news-wrong-20260905000000000');
  });

  it('tracks speed, captions, cue, answer, and save states locally', () => {
    const initial = createListenMvpInteractionState(null);
    const atSlowSpeed = reduceListenMvpInteractionState(initial, {
      type: 'set-playback-rate', value: 0.75,
    });
    const captionsOff = reduceListenMvpInteractionState(atSlowSpeed, { type: 'toggle-captions' });
    const cueSelected = reduceListenMvpInteractionState(captionsOff, {
      type: 'set-cue', cueId: 'cue-1',
    });
    const answerSelected = reduceListenMvpInteractionState(cueSelected, {
      type: 'select-answer', answer: 'Book a room',
    });
    const saving = reduceListenMvpInteractionState(answerSelected, { type: 'save-start', requestId: 1 });
    const saved = reduceListenMvpInteractionState(saving, { type: 'save-success', requestId: 1 });

    expect(saved).toMatchObject({
      playbackRate: 0.75,
      captionsVisible: false,
      activeCueId: 'cue-1',
      selectedAnswer: 'Book a room',
      saveState: 'saved',
      saveRequestId: 1,
    });
    expect(reduceListenMvpInteractionState(saved, {
      type: 'reset', initialCueId: null,
    })).toMatchObject({ activeCueId: null, selectedAnswer: null, saveState: 'idle', saveRequestId: 2 });
  });

  it('ignores a save result from a lesson that was reset while saving', () => {
    const saving = reduceListenMvpInteractionState(createListenMvpInteractionState(null), {
      type: 'save-start', requestId: 1,
    });
    const nextLesson = reduceListenMvpInteractionState(saving, {
      type: 'reset', initialCueId: 'cue-2',
    });

    expect(reduceListenMvpInteractionState(nextLesson, {
      type: 'save-success', requestId: 1,
    })).toMatchObject({ activeCueId: 'cue-2', saveState: 'idle', saveRequestId: 2 });
  });

  it('replays from the beginning and reports playback failure without throwing', async () => {
    const audio = { currentTime: 12, play: vi.fn(async () => undefined) };
    await expect(replayListenAudio(audio, vi.fn())).resolves.toBe('played');
    expect(audio.currentTime).toBe(0);
    expect(audio.play).toHaveBeenCalledOnce();

    const failedAudio = { currentTime: 8, play: vi.fn(async () => { throw new Error('blocked'); }) };
    const onError = vi.fn();
    await expect(replayListenAudio(failedAudio, onError)).resolves.toBe('failed');
    expect(failedAudio.currentTime).toBe(0);
    expect(onError).toHaveBeenCalledOnce();
  });

  it('runs the save callback and normalizes success or failure locally', async () => {
    const save = vi.fn(async () => undefined);
    await expect(runListenSave(chunk, save)).resolves.toBe('saved');
    expect(save).toHaveBeenCalledWith(chunk);

    const failedSave = vi.fn(async () => { throw new Error('offline'); });
    await expect(runListenSave(chunk, failedSave)).resolves.toBe('failed');
  });
});
