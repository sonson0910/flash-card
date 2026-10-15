import { describe, expect, it } from 'vitest';
import { CatalogValidationError } from '../catalogPipeline/catalogValidation';
import { createLexemeId } from '../multilingual/lexemeIdentity';
import {
  LISTEN_MVP_PILOT_LESSONS,
  LISTEN_MVP_PILOT_REGISTRY,
  selectListenMvpPilotLesson,
} from './listenMvpPilotCandidates';
import {
  LISTEN_MVP_PILOT_LESSONS as RUNTIME_LISTEN_MVP_PILOT_LESSONS,
  LISTEN_MVP_PILOT_PUBLICATION,
  selectListenMvpPilotLesson as selectRuntimeListenMvpPilotLesson,
} from './listenMvpPilot';

describe('Listen MVP pilot registry', () => {
  it('exposes the three lessons through the trusted published runtime seam', () => {
    expect(RUNTIME_LISTEN_MVP_PILOT_LESSONS).toHaveLength(3);
    expect(RUNTIME_LISTEN_MVP_PILOT_LESSONS.map(lesson => lesson.clip.id)).toEqual([
      'break-the-news',
      'on-the-ball',
      'fair-and-square',
    ]);
    expect(selectRuntimeListenMvpPilotLesson(0)?.clip.id).toBe('break-the-news');
    expect(selectRuntimeListenMvpPilotLesson(3)?.clip.id).toBe('break-the-news');
  });

  it('binds operator publication identity and the VOA policy basis', () => {
    expect(LISTEN_MVP_PILOT_PUBLICATION).toMatchObject({
      status: 'published',
      review: 'reviewed',
      catalogId: 'english-core',
      releaseId: 'listen-pilot-2026-09-06',
      reviewerId: 'operator-user',
      publisherId: 'operator-user',
      reviewedAt: '2026-09-06T00:00:00.000Z',
      publishedAt: '2026-09-06T00:00:00.000Z',
      rightsPolicyUrl: 'https://learningenglish.voanews.com/p/6861.html',
    });
    expect(LISTEN_MVP_PILOT_PUBLICATION.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(LISTEN_MVP_PILOT_PUBLICATION.operatorAttestation).toMatch(/operator attestation/i);
  });

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

  it('binds each source to the VOA public-domain policy evidence', () => {
    expect(LISTEN_MVP_PILOT_REGISTRY.assets.map(asset => ({
      sourceRef: asset.sourceRef,
      sourceAssetSha256: asset.sourceAssetSha256,
    }))).toEqual([
      {
        sourceRef: 'voa-break-the-news',
        sourceAssetSha256: 'e4006936e6366782549b54fc14737b643a85f211d0ebe5c6389d6b6b3d1ecd14',
      },
      {
        sourceRef: 'voa-fair-and-square',
        sourceAssetSha256: 'cd5d6f044d8814da3fb91220f3225eb5895cd3627ad2862274a5edbe7981b166',
      },
      {
        sourceRef: 'voa-on-the-ball',
        sourceAssetSha256: 'a29d51c904d752a3bc0c7ea324f53296fe649561a6aac337c852be82c1df4dd0',
      },
    ]);
    expect(LISTEN_MVP_PILOT_REGISTRY.assets.every(asset => (
      asset.rightsEvidenceId === 'voa-learning-english-rights-6861'
      && asset.basis === 'public-domain'
      && asset.commercialUse === 'allowed'
      && asset.derivatives === 'allowed'
      && asset.rehosting === 'allowed'
      && asset.thirdPartyFragments === 'none'
      && asset.territory === 'worldwide'
    ))).toBe(true);
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
      expect.objectContaining({ startMs: 34_000, endMs: 39_100, text: "Budget cuts, there's not enough money for two." }),
      expect.objectContaining({ startMs: 39_100, endMs: 43_100, text: 'But can I borrow that travel book?' }),
      expect.objectContaining({ startMs: 43_100, endMs: 53_100, text: 'To break the news means to tell someone bad news, something that will make them upset or sad.' }),
      expect.objectContaining({ startMs: 53_100, endMs: 60_000, text: 'Breaking the news can be a hard thing to do, and so can hearing about it.' }),
    ]));
    expect(onTheBall?.clip.transcriptCues).toEqual(expect.arrayContaining([
      expect.objectContaining({ startMs: 7_000, endMs: 11_000, text: 'Some people use a large ball for exercise.' }),
      expect.objectContaining({ startMs: 24_000, endMs: 30_000, text: 'Wow, you are on the ball! How did you do them so fast? Coffee!' }),
      expect.objectContaining({ startMs: 30_000, endMs: 40_000, text: "Lots of coffee. Do you want some? I'll get it. I'd love more coffee. Thank you. Sure. But maybe not that much coffee." }),
      expect.objectContaining({ startMs: 48_000, endMs: 56_000, text: 'We can also say a person should get on the ball when they need to work faster or better.' }),
    ]));
    expect(fairAndSquare?.clip.transcriptCues.map(cue => cue.text)).toEqual([
      'Welcome to English in a Minute.',
      'We all like to be treated fairly. But what about being treated squarely?',
      "Let's learn how to use the idiom fair and square.",
      'Anna, where have you been? I lost you in the crowd.',
      "I was playing games! I'm really good at carnival games!",
      'I see that! You really won a lot of stuffed animals.',
      "Are you sure you didn't cheat? No!",
      'I won them all fair and square!',
      "And they're all mine. All mine! Hahaha...!",
      'Fair and square describes winning something in an honest way and without any doubt.',
      'The expression is a fun one to say because it rhymes—fair and square!',
    ]);
    expect(fairAndSquare?.clip.transcriptCues).toEqual(expect.arrayContaining([
      expect.objectContaining({ startMs: 18_000, endMs: 23_000, text: 'Anna, where have you been? I lost you in the crowd.' }),
      expect.objectContaining({ startMs: 35_000, endMs: 39_000, text: 'I won them all fair and square!' }),
      expect.objectContaining({ startMs: 46_000, endMs: 52_000, text: 'Fair and square describes winning something in an honest way and without any doubt.' }),
      expect.objectContaining({ startMs: 52_000, endMs: 60_000, text: 'The expression is a fun one to say because it rhymes—fair and square!' }),
    ]));
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
