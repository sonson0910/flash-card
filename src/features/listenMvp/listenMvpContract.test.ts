import { describe, expect, it } from 'vitest';
import {
  CatalogValidationError,
  parseCatalogSourceAssetRegistryV1,
} from '../catalogPipeline/catalogValidation';
import {
  activeListenTranscriptCue,
  LISTEN_MVP_LIMITS,
  parseListenMvpLessonV1,
} from './listenMvpContract';

const sourceAssetSha256 = 'a'.repeat(64);

const registry = () => parseCatalogSourceAssetRegistryV1({
  registryVersion: 1,
  assets: [{
    sourceRef: 'voa-learning-english-pilot',
    sourceUrl: 'https://learningenglish.voanews.com/example',
    licenseId: 'PUBLIC-DOMAIN',
    rightsEvidenceId: 'rights:voa-2026',
    basis: 'public-domain',
    commercialUse: 'allowed',
    derivatives: 'allowed',
    rehosting: 'allowed',
    attribution: { required: true, text: 'Voice of America Learning English' },
    thirdPartyFragments: 'none',
    territory: 'worldwide',
    expiresAt: null,
    sourceRevision: 'revision-1',
    sourceAssetSha256,
    revokedAt: null,
  }],
});

const clip = () => ({
  schemaVersion: 1,
  id: 'hotel-clip',
  language: 'en',
  mediaKind: 'audio' as const,
  path: 'media/hotel-clip.mp3',
  mimeType: 'audio/mpeg',
  byteLength: 4_096,
  durationMs: 5_000,
  contentRights: {
    schemaVersion: 1,
    registryVersion: 1,
    sourceRef: 'voa-learning-english-pilot',
    sourceAssetSha256,
  },
  transcriptCues: [
    { schemaVersion: 1, id: 'cue-1', clipId: 'hotel-clip', language: 'en', startMs: 0, endMs: 2_000, text: 'I would like to book a room.' },
    { schemaVersion: 1, id: 'cue-2', clipId: 'hotel-clip', language: 'en', startMs: 2_500, endMs: 4_500, text: 'For two nights, please.' },
  ],
});

const chunk = () => ({
  schemaVersion: 1,
  id: 'book-a-room',
  language: 'en',
  kind: 'phrase' as const,
  text: 'book a room',
  lexemeIds: ['book'],
  contentRights: {
    schemaVersion: 1,
    registryVersion: 1,
    sourceRef: 'voa-learning-english-pilot',
    sourceAssetSha256,
  },
});

const lesson = () => ({
  clip: clip(),
  chunk: chunk(),
  comprehension: {
    question: 'What does the speaker want to do?',
    options: ['Book a room', 'Buy a ticket'],
    answer: 'Book a room',
  },
});

describe('Listen MVP lesson contract', () => {
  it('accepts a rights-bound audio lesson and exposes sentence cues', () => {
    const parsed = parseListenMvpLessonV1(lesson(), registry(), new Set(['book']));

    expect(parsed.clip.id).toBe('hotel-clip');
    expect(parsed.chunk.text).toBe('book a room');
    expect(parsed.sources).toEqual([{
      sourceRef: 'voa-learning-english-pilot',
      sourceUrl: 'https://learningenglish.voanews.com/example',
      licenseId: 'PUBLIC-DOMAIN',
      attribution: 'Voice of America Learning English',
    }]);
    expect(activeListenTranscriptCue(parsed.clip, 0)?.id).toBe('cue-1');
    expect(activeListenTranscriptCue(parsed.clip, 2_000)).toBeNull();
    expect(activeListenTranscriptCue(parsed.clip, 2_500)?.id).toBe('cue-2');
  });

  it('requires a trusted source link, known lexemes, and an answer option', () => {
    expect(() => parseListenMvpLessonV1(
      lesson(),
      registry(),
      undefined as unknown as ReadonlySet<string>,
    )).toThrow(/knownLexemeIds/i);
    expect(() => parseListenMvpLessonV1(lesson(), registry(), new Set(['other'])))
      .toThrow(/known lexeme/i);
    expect(() => parseListenMvpLessonV1({
      ...lesson(), comprehension: { ...lesson().comprehension, answer: 'Unknown' },
    }, registry(), new Set(['book']))).toThrow(/match one option/i);
    expect(() => parseListenMvpLessonV1(lesson(), parseCatalogSourceAssetRegistryV1({
      registryVersion: 1,
      assets: [{
        ...registry().assets[0], sourceUrl: null,
      }],
    }), new Set(['book']))).toThrow(/source URL/i);
  });

  it('bounds and rejects malformed comprehension choices', () => {
    expect(() => parseListenMvpLessonV1({
      ...lesson(), comprehension: { ...lesson().comprehension, options: ['Only one'] },
    }, registry(), new Set(['book']))).toThrow(CatalogValidationError);
    expect(() => parseListenMvpLessonV1({
      ...lesson(), comprehension: {
        ...lesson().comprehension,
        options: Array.from(
          { length: LISTEN_MVP_LIMITS.maximumAnswerOptions + 1 },
          (_, index) => `Option ${index}`,
        ),
      },
    }, registry(), new Set(['book']))).toThrow(CatalogValidationError);
    expect(() => parseListenMvpLessonV1({
      ...lesson(), unexpected: true,
    }, registry(), new Set(['book']))).toThrow(CatalogValidationError);
  });
});
