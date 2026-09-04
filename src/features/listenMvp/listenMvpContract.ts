import type {
  CatalogContentChunkV1,
  CatalogMediaClipV1,
  CatalogSourceAssetRegistryV1,
  CatalogTranscriptCueV1,
} from '../catalogPipeline/catalogContracts';
import {
  assertCatalogContentReferences,
  CatalogValidationError,
  parseCatalogContentChunkV1,
  parseCatalogMediaClipV1,
} from '../catalogPipeline/catalogValidation';

export const LISTEN_MVP_LIMITS = Object.freeze({
  maximumQuestionLength: 512,
  minimumAnswerOptions: 2,
  maximumAnswerOptions: 4,
  maximumAnswerOptionLength: 256,
} as const);

export interface ListenMvpSourceV1 {
  readonly sourceRef: string;
  readonly sourceUrl: string;
  readonly licenseId: string;
  readonly attribution: string;
}

export interface ListenMvpComprehensionV1 {
  readonly question: string;
  readonly options: readonly string[];
  readonly answer: string;
}

export interface ListenMvpLessonV1 {
  readonly clip: CatalogMediaClipV1;
  readonly chunk: CatalogContentChunkV1;
  readonly comprehension: ListenMvpComprehensionV1;
  readonly sources: readonly ListenMvpSourceV1[];
}

const fail = (path: string, message: string): never => {
  throw new CatalogValidationError(`${path}: ${message}`);
};

const recordAt = (value: unknown, path: string, keys: readonly string[]): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, 'expected object');
  }
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).find(key => !keys.includes(key));
  if (unknown) fail(`${path}.${unknown}`, 'unknown field');
  return record;
};

const textAt = (value: unknown, path: string, maximum: number): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    fail(path, `expected 1-${maximum} characters`);
  }
  const parsed = value as string;
  if (parsed !== parsed.normalize('NFKC').trim()) fail(path, 'must be canonical and trimmed');
  return parsed;
};

const optionsAt = (value: unknown, path: string): readonly string[] => {
  if (!Array.isArray(value)) fail(path, 'expected array');
  const options = value as unknown[];
  if (options.length < LISTEN_MVP_LIMITS.minimumAnswerOptions) {
    fail(path, `requires at least ${LISTEN_MVP_LIMITS.minimumAnswerOptions} options`);
  }
  if (options.length > LISTEN_MVP_LIMITS.maximumAnswerOptions) {
    fail(path, `exceeds ${LISTEN_MVP_LIMITS.maximumAnswerOptions} options`);
  }
  for (let index = 0; index < options.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(options, index)) {
      fail(`${path}[${index}]`, 'expected a dense array');
    }
  }
  const parsed = options.map((option, index) => textAt(
    option,
    `${path}[${index}]`,
    LISTEN_MVP_LIMITS.maximumAnswerOptionLength,
  ));
  if (new Set(parsed).size !== parsed.length) fail(path, 'contains duplicate options');
  return parsed;
};

const sourceFor = (
  sourceRef: string,
  registry: CatalogSourceAssetRegistryV1,
): ListenMvpSourceV1 => {
  const asset = registry.assets.find(candidate => candidate.sourceRef === sourceRef)
    ?? fail('lesson.sources', `does not reference a trusted asset: ${sourceRef}`);
  const sourceUrl = asset.sourceUrl;
  if (sourceUrl === null) return fail('lesson.sources', `trusted asset has no source URL: ${sourceRef}`);
  return {
    sourceRef: asset.sourceRef,
    sourceUrl,
    licenseId: asset.licenseId,
    attribution: asset.attribution.text ?? 'Attribution not required by the source record.',
  };
};

const uniqueSources = (
  clip: CatalogMediaClipV1,
  chunk: CatalogContentChunkV1,
  registry: CatalogSourceAssetRegistryV1,
): readonly ListenMvpSourceV1[] => {
  const sourceRefs = [...new Set([
    clip.contentRights.sourceRef,
    chunk.contentRights.sourceRef,
  ])];
  return sourceRefs.map(sourceRef => sourceFor(sourceRef, registry));
};

export function parseListenMvpLessonV1(
  value: unknown,
  registry: CatalogSourceAssetRegistryV1,
  knownLexemeIds: ReadonlySet<string>,
): ListenMvpLessonV1 {
  const record = recordAt(value, 'lesson', ['clip', 'chunk', 'comprehension']);
  const clip = parseCatalogMediaClipV1(record.clip);
  if (clip.mediaKind !== 'audio') fail('lesson.clip.mediaKind', 'Listen lessons require audio clips');
  if (clip.transcriptCues.length === 0) {
    fail('lesson.clip.transcriptCues', 'Listen lessons require at least one sentence cue');
  }
  const chunk = parseCatalogContentChunkV1(record.chunk);
  assertCatalogContentReferences(clip, registry);
  if (knownLexemeIds === undefined) fail('lesson.knownLexemeIds', 'is required for a saveable chunk');
  assertCatalogContentReferences(chunk, registry, knownLexemeIds);
  const comprehension = recordAt(record.comprehension, 'lesson.comprehension', [
    'question', 'options', 'answer',
  ]);
  const question = textAt(
    comprehension.question,
    'lesson.comprehension.question',
    LISTEN_MVP_LIMITS.maximumQuestionLength,
  );
  const options = optionsAt(comprehension.options, 'lesson.comprehension.options');
  const answer = textAt(
    comprehension.answer,
    'lesson.comprehension.answer',
    LISTEN_MVP_LIMITS.maximumAnswerOptionLength,
  );
  if (!options.includes(answer)) fail('lesson.comprehension.answer', 'must match one option');
  return {
    clip,
    chunk,
    comprehension: { question, options, answer },
    sources: uniqueSources(clip, chunk, registry),
  };
}

export const activeListenTranscriptCue = (
  clip: CatalogMediaClipV1,
  currentTimeMs: number,
): CatalogTranscriptCueV1 | null => {
  if (!Number.isFinite(currentTimeMs) || currentTimeMs < 0) return null;
  return clip.transcriptCues.find(cue => (
    currentTimeMs >= cue.startMs && currentTimeMs < cue.endMs
  )) ?? null;
};

export const initialListenCueId = (clip: CatalogMediaClipV1): string | null => (
  activeListenTranscriptCue(clip, 0)?.id ?? null
);
