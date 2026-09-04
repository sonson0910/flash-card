import { describe, expect, it, vi } from 'vitest';
import {
  createListenMvpInteractionState,
  reduceListenMvpInteractionState,
  replayListenAudio,
  runListenSave,
} from './listenMvpInteraction';

const chunk = { id: 'book-a-room' } as Parameters<typeof runListenSave>[0];

describe('Listen MVP interaction model', () => {
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
    const saving = reduceListenMvpInteractionState(answerSelected, { type: 'save-start' });
    const saved = reduceListenMvpInteractionState(saving, { type: 'save-success' });

    expect(saved).toMatchObject({
      playbackRate: 0.75,
      captionsVisible: false,
      activeCueId: 'cue-1',
      selectedAnswer: 'Book a room',
      saveState: 'saved',
    });
    expect(reduceListenMvpInteractionState(saved, {
      type: 'reset', initialCueId: null,
    })).toMatchObject({ activeCueId: null, selectedAnswer: null, saveState: 'idle' });
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
