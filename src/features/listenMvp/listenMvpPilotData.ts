import type {
  CatalogContentChunkV1,
  CatalogMediaClipV1,
  CatalogSourceAssetRegistryV1,
} from '../catalogPipeline/catalogContracts';
import type { ListenMvpLessonV1, ListenMvpSourceV1 } from './listenMvpContract';

const BREAK_THE_NEWS_SHA256 = 'e4006936e6366782549b54fc14737b643a85f211d0ebe5c6389d6b6b3d1ecd14';
const ON_THE_BALL_SHA256 = 'a29d51c904d752a3bc0c7ea324f53296fe649561a6aac337c852be82c1df4dd0';
const FAIR_AND_SQUARE_SHA256 = 'cd5d6f044d8814da3fb91220f3225eb5895cd3627ad2862274a5edbe7981b166';
const BREAK_THE_NEWS_LEXEME_ID = 'lexeme-5b22656e222c22627265616b20746865206e657773222c22706872617365222c22627265616b2d7468652d6e65-d146b943fa604420dac43b0a';
const ON_THE_BALL_LEXEME_ID = 'lexeme-5b22656e222c226f6e207468652062616c6c222c22706872617365222c226f6e2d7468652d62616c6c225d-20c7740a169a1c6d10033429';
const FAIR_AND_SQUARE_LEXEME_ID = 'lexeme-5b22656e222c226661697220616e6420737175617265222c22706872617365222c22666169722d616e642d7371-badc00e3cc7c73fed8ce474d';
export const VOA_ATTRIBUTION = 'Voice of America Learning English';
export const VOA_RIGHTS_URL = 'https://learningenglish.voanews.com/p/6861.html';

const sourceInfo = (sourceRef: string, sourceUrl: string): ListenMvpSourceV1 => ({
  sourceRef,
  sourceUrl,
  licenseId: 'PUBLIC-DOMAIN',
  attribution: VOA_ATTRIBUTION,
});

const source = (
  sourceRef: string,
  sourceUrl: string,
  sourceAssetSha256: string,
  sourceRevision: string,
) => ({
  sourceRef,
  sourceUrl,
  licenseId: 'PUBLIC-DOMAIN',
  rightsEvidenceId: 'voa-learning-english-rights-6861',
  basis: 'public-domain' as const,
  commercialUse: 'allowed' as const,
  derivatives: 'allowed' as const,
  rehosting: 'allowed' as const,
  attribution: { required: true, text: VOA_ATTRIBUTION },
  thirdPartyFragments: 'none' as const,
  territory: 'worldwide' as const,
  expiresAt: null,
  sourceRevision,
  sourceAssetSha256,
  revokedAt: null,
});

export const LISTEN_MVP_PILOT_REGISTRY_DATA = {
  registryVersion: 1,
  assets: [
    source('voa-break-the-news', 'https://learningenglish.voanews.com/a/7949136.html', BREAK_THE_NEWS_SHA256, '2025-01-27'),
    source('voa-on-the-ball', 'https://learningenglish.voanews.com/a/7990719.html', ON_THE_BALL_SHA256, '2025-03-03'),
    source('voa-fair-and-square', 'https://learningenglish.voanews.com/a/7932782.html', FAIR_AND_SQUARE_SHA256, '2025-01-13'),
  ],
} satisfies CatalogSourceAssetRegistryV1;

const chunkFor = (
  id: string,
  text: string,
  lexemeId: string,
  sourceRef: string,
  sourceAssetSha256: string,
): CatalogContentChunkV1 => ({
  schemaVersion: 1,
  id,
  language: 'en',
  kind: 'idiom',
  text,
  lexemeIds: [lexemeId],
  contentRights: { schemaVersion: 1, registryVersion: 1, sourceRef, sourceAssetSha256 },
});

const clipFor = (
  id: string,
  path: string,
  byteLength: number,
  sourceRef: string,
  sourceAssetSha256: string,
  transcriptCues: CatalogMediaClipV1['transcriptCues'],
): CatalogMediaClipV1 => ({
  schemaVersion: 1,
  id,
  language: 'en',
  mediaKind: 'audio',
  path,
  mimeType: 'audio/mp4',
  byteLength,
  durationMs: 60_000,
  contentRights: { schemaVersion: 1, registryVersion: 1, sourceRef, sourceAssetSha256 },
  transcriptCues,
});

const cue = (clipId: string, id: string, startMs: number, endMs: number, text: string) => ({
  schemaVersion: 1 as const,
  id,
  clipId,
  language: 'en',
  startMs,
  endMs,
  text,
});

export const LISTEN_MVP_PILOT_LESSONS_DATA = [
  {
    clip: clipFor('break-the-news', 'media/listen-mvp/break-the-news.m4a', 733_106, 'voa-break-the-news', BREAK_THE_NEWS_SHA256, [
      cue('break-the-news', 'break-the-news-cue-1', 3_000, 5_000, 'Welcome to English in a Minute.'),
      cue('break-the-news', 'break-the-news-cue-2', 5_000, 11_000, 'News can be any information that is, well, new to someone.'),
      cue('break-the-news', 'break-the-news-cue-3', 11_000, 14_000, 'But what does it mean to break the news?'),
      cue('break-the-news', 'break-the-news-cue-4', 14_000, 20_000, 'So, are you all ready for our big work trip to Brazil?'),
      cue('break-the-news', 'break-the-news-cue-5', 20_000, 27_000, 'I just bought a new travel shirt, travel sunglasses, and this travel guidebook!'),
      cue('break-the-news', 'break-the-news-cue-6', 27_000, 34_000, "Andrew, I hate to break the news, but you're not traveling."),
      cue('break-the-news', 'break-the-news-cue-7', 34_000, 37_000, "Budget cuts, there's not enough money for two."),
      cue('break-the-news', 'break-the-news-cue-8', 37_000, 40_000, 'But can I borrow that travel book?'),
      cue('break-the-news', 'break-the-news-cue-9', 40_000, 51_000, 'To break the news means to tell someone bad news, something that will make them upset or sad.'),
      cue('break-the-news', 'break-the-news-cue-10', 51_000, 60_000, 'Breaking the news can be a hard thing to do, and so can hearing about it.'),
    ]),
    chunk: chunkFor('break-the-news', 'break the news', BREAK_THE_NEWS_LEXEME_ID, 'voa-break-the-news', BREAK_THE_NEWS_SHA256),
    sources: [sourceInfo('voa-break-the-news', 'https://learningenglish.voanews.com/a/7949136.html')],
    comprehension: {
      question: 'What does “break the news” mean?',
      options: ['Tell someone important information', 'Hide a newspaper', 'Fix a broken story'],
      answer: 'Tell someone important information',
    },
  },
  {
    clip: clipFor('on-the-ball', 'media/listen-mvp/on-the-ball.m4a', 733_022, 'voa-on-the-ball', ON_THE_BALL_SHA256, [
      cue('on-the-ball', 'on-the-ball-cue-1', 7_000, 11_000, 'Some people use a large ball for exercise.'),
      cue('on-the-ball', 'on-the-ball-cue-2', 11_000, 16_000, 'Is that what to get on the ball means?'),
      cue('on-the-ball', 'on-the-ball-cue-3', 16_000, 18_000, 'Hi, Anna. How has your day been?'),
      cue('on-the-ball', 'on-the-ball-cue-4', 18_000, 24_000, 'Great! Very great! Very productive! I finished three reports and have only one more to do.'),
      cue('on-the-ball', 'on-the-ball-cue-5', 24_000, 29_000, 'You are on the ball. How did you do them so fast? Coffee. Lots of coffee.'),
      cue('on-the-ball', 'on-the-ball-cue-6', 29_000, 35_000, "Do you want some? I'll get it. I'd love more coffee. Thank you. Sure. But maybe not that much coffee."),
      cue('on-the-ball', 'on-the-ball-cue-7', 39_000, 47_000, 'Someone who is on the ball finishes work quickly and ahead of time.'),
      cue('on-the-ball', 'on-the-ball-cue-8', 47_000, 54_000, 'We can also say a person should get on the ball when they need to work faster or better.'),
    ]),
    chunk: chunkFor('on-the-ball', 'on the ball', ON_THE_BALL_LEXEME_ID, 'voa-on-the-ball', ON_THE_BALL_SHA256),
    sources: [sourceInfo('voa-on-the-ball', 'https://learningenglish.voanews.com/a/7990719.html')],
    comprehension: {
      question: 'What is an on-the-ball person like?',
      options: ['Alert and ready', 'Slow and confused', 'Quiet and tired'],
      answer: 'Alert and ready',
    },
  },
  {
    clip: clipFor('fair-and-square', 'media/listen-mvp/fair-and-square.m4a', 733_123, 'voa-fair-and-square', FAIR_AND_SQUARE_SHA256, [
      cue('fair-and-square', 'fair-and-square-cue-1', 0, 6_000, 'Welcome to English in a Minute.'),
      cue('fair-and-square', 'fair-and-square-cue-2', 6_000, 18_000, 'We all like to be treated fairly. But what about being treated squarely?'),
      cue('fair-and-square', 'fair-and-square-cue-3', 18_000, 26_000, 'Anna: I won them fair and square!'),
      cue('fair-and-square', 'fair-and-square-cue-4', 26_000, 43_000, 'Fair and square describes winning something in an honest way and without any doubt.'),
    ]),
    chunk: chunkFor('fair-and-square', 'fair and square', FAIR_AND_SQUARE_LEXEME_ID, 'voa-fair-and-square', FAIR_AND_SQUARE_SHA256),
    sources: [sourceInfo('voa-fair-and-square', 'https://learningenglish.voanews.com/a/7932782.html')],
    comprehension: {
      question: 'What does “fair and square” describe?',
      options: ['An honest result', 'A secret shortcut', 'A square object'],
      answer: 'An honest result',
    },
  },
] as const satisfies readonly ListenMvpLessonV1[];

export const LISTEN_MVP_PILOT_LESSONS = Object.freeze(LISTEN_MVP_PILOT_LESSONS_DATA);
export const listenMvpPilotLessons = LISTEN_MVP_PILOT_LESSONS;

export function selectListenMvpPilotLesson(index: number): ListenMvpLessonV1 | null {
  if (!Number.isSafeInteger(index)) return null;
  const normalizedIndex = ((index % LISTEN_MVP_PILOT_LESSONS.length) + LISTEN_MVP_PILOT_LESSONS.length)
    % LISTEN_MVP_PILOT_LESSONS.length;
  return LISTEN_MVP_PILOT_LESSONS[normalizedIndex] ?? null;
}
