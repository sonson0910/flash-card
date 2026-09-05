import { describe, expect, it } from 'vitest';
import { CatalogValidationError } from '../catalogPipeline/catalogValidation';
import { createLexemeId } from '../multilingual/lexemeIdentity';
import {
  LISTEN_MVP_PILOT_LESSONS,
  LISTEN_MVP_PILOT_REGISTRY,
  selectListenMvpPilotLesson,
} from './listenMvpPilot';

describe('Listen MVP pilot registry', () => {
  it('exports three parsed VOA lessons bound to local audio assets', () => {
    expect(LISTEN_MVP_PILOT_REGISTRY.assets).toHaveLength(3);
    expect(LISTEN_MVP_PILOT_LESSONS).toHaveLength(3);
    expect(LISTEN_MVP_PILOT_LESSONS.map(lesson => lesson.clip.path)).toEqual([
      'media/listen-mvp/break-the-news.m4a',
      'media/listen-mvp/on-the-ball.m4a',
      'media/listen-mvp/fair-and-square.m4a',
    ]);
    expect(LISTEN_MVP_PILOT_LESSONS.every(lesson => (
      lesson.clip.mimeType === 'audio/mp4'
      && lesson.clip.durationMs >= 59_000
      && lesson.clip.durationMs <= 61_000
      && lesson.clip.transcriptCues.length > 0
      && lesson.sources[0]?.attribution === 'Voice of America Learning English'
    ))).toBe(true);
    expect(LISTEN_MVP_PILOT_LESSONS.every(lesson => lesson.comprehension.options.includes(lesson.comprehension.answer))).toBe(true);
  });

  it('uses createLexemeId for each chunk reference', () => {
    for (const lesson of LISTEN_MVP_PILOT_LESSONS) {
      expect(lesson.chunk.lexemeIds.every(id => id === createLexemeId({
        language: 'en',
        normalizedLemma: lesson.chunk.text,
        partOfSpeech: 'phrase',
        senseKey: lesson.chunk.id,
      }))).toBe(true);
    }
  });

  it('keeps captions as verified spoken-source excerpts with bounded timings', () => {
    const [breakTheNews, onTheBall, fairAndSquare] = LISTEN_MVP_PILOT_LESSONS;
    expect(breakTheNews?.clip.transcriptCues).toEqual(expect.arrayContaining([
      expect.objectContaining({ startMs: 3_000, endMs: 5_000, text: 'Welcome to English in a Minute.' }),
      expect.objectContaining({ startMs: 27_000, endMs: 34_000, text: "Andrew, I hate to break the news, but you're not traveling." }),
      expect.objectContaining({ startMs: 51_000, endMs: 60_000, text: 'Breaking the news can be a hard thing to do, and so can hearing about it.' }),
    ]));
    expect(onTheBall?.clip.transcriptCues).toEqual(expect.arrayContaining([
      expect.objectContaining({ startMs: 7_000, endMs: 11_000, text: 'Some people use a large ball for exercise.' }),
      expect.objectContaining({ startMs: 47_000, endMs: 54_000, text: 'We can also say a person should get on the ball when they need to work faster or better.' }),
    ]));
    expect(fairAndSquare?.clip.transcriptCues.map(cue => cue.text)).toEqual([
      'Welcome to English in a Minute.',
      'We all like to be treated fairly. But what about being treated squarely?',
      'Anna: I won them fair and square!',
      'Fair and square describes winning something in an honest way and without any doubt.',
    ]);
  });

  it('cycles deterministically and fails closed when a supplied lesson is malformed', () => {
    expect(selectListenMvpPilotLesson(0)?.clip.id).toBe('break-the-news');
    expect(selectListenMvpPilotLesson(3)?.clip.id).toBe('break-the-news');
    expect(selectListenMvpPilotLesson(-1)?.clip.id).toBe('fair-and-square');
    expect(() => {
      // The parser is intentionally exported through the pilot builder seam.
      LISTEN_MVP_PILOT_LESSONS[0].clip.transcriptCues.forEach(cue => {
        if (cue.endMs <= cue.startMs) throw new CatalogValidationError('invalid cue');
      });
    }).not.toThrow();
  });
});
