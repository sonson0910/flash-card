import { describe, expect, it } from 'vitest';
import {
  createDailyLearningLocation,
  readDailyLearningUrlState,
} from './dailyLearningUrl';

describe('daily learning URL seam', () => {
  it('reads only bounded known lesson modes while Today owns the session', () => {
    expect(readDailyLearningUrlState('?lesson=recognition')).toEqual({ view: 'today', lesson: 'recognition' });
    expect(readDailyLearningUrlState('?view=today&lesson=sentence-building')).toEqual({
      view: 'today', lesson: 'sentence-building',
    });
    expect(readDailyLearningUrlState('?view=catalog&lesson=spelling')).toEqual({
      view: 'catalog', lesson: null,
    });
    expect(readDailyLearningUrlState('?view=unknown&lesson=unknown')).toEqual({
      view: 'today', lesson: null,
    });
  });

  it('writes and closes a lesson while preserving unrelated parameters and hash', () => {
    expect(createDailyLearningLocation(
      '/?utm_source=phase5&share=deck-1#today-heading',
      { view: 'today', lesson: 'active-recall' },
    )).toBe('/?utm_source=phase5&share=deck-1&lesson=active-recall#today-heading');

    expect(createDailyLearningLocation(
      '/?utm_source=phase5&lesson=cloze#lesson-heading',
      { view: 'today', lesson: null },
    )).toBe('/?utm_source=phase5#lesson-heading');
  });

  it('removes obsolete lesson state whenever navigation leaves Today', () => {
    expect(createDailyLearningLocation(
      '/?lesson=listening&utm_source=phase5#shell',
      { view: 'catalog', lesson: 'listening' },
    )).toBe('/?utm_source=phase5&view=catalog#shell');
  });
});
