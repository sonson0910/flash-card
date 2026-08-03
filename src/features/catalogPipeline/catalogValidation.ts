import {
  canonicalizeLexemeIdentity,
  canonicalizeTrackMembershipIdentity,
} from '../multilingual/lexemeIdentity';
import {
  parseLexemeV3,
  parseTrackMembershipV3,
} from '../multilingual/schemaV3Validation';
import type { LexemeV3, TrackMembershipV3 } from '../multilingual/schemaV3';
import {
  CATALOG_PIPELINE_LIMITS,
  type CatalogCandidateProvenanceV1,
  type CatalogChunkDescriptorV1,
  type CatalogChunkV1,
  type CatalogIssue,
  type CatalogLexemeCandidateV1,
  type CatalogMembershipCandidateV1,
  type CatalogReleaseCountsV1,
  type CatalogReleaseManifestV1,
  type CatalogReviewEvidenceV1,
  type CatalogSourceManifestV1,
  type CatalogValidationResult,
} from './catalogContracts';

type UnknownRecord = Record<string, unknown>;

export class CatalogValidationError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogValidationError';
  }
}

const fail = (path: string, message: string): never => {
  throw new CatalogValidationError(`${path}: ${message}`);
};

const recordAt = (value: unknown, path: string, keys: readonly string[]): UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, 'expected object');
  }
  const record = value as UnknownRecord;
  const unknown = Object.keys(record).find(key => !keys.includes(key));
  if (unknown) fail(`${path}.${unknown}`, 'unknown field');
  return record;
};

const stringAt = (value: unknown, path: string, maximum: number): string => {
  if (typeof value !== 'string') fail(path, 'expected string');
  const parsed = value as string;
  if (!parsed || parsed.length > maximum) fail(path, `expected 1-${maximum} characters`);
  if (parsed !== parsed.normalize('NFKC').trim()) fail(path, 'must be canonical and trimmed');
  return parsed;
};

const enumAt = <T extends string>(
  value: unknown,
  path: string,
  values: readonly T[],
): T => {
  const parsed = stringAt(value, path, CATALOG_PIPELINE_LIMITS.maximumIdentifierLength);
  if (!values.includes(parsed as T)) fail(path, 'unsupported value');
  return parsed as T;
};

const integerAt = (
  value: unknown,
  path: string,
  maximum: number,
  minimum = 0,
): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    fail(path, `expected safe integer between ${minimum} and ${maximum}`);
  }
  return Number(value);
};

const arrayAt = <T>(
  value: unknown,
  path: string,
  maximum: number,
  parse: (item: unknown, itemPath: string) => T,
): readonly T[] => {
  if (!Array.isArray(value)) fail(path, 'expected array');
  const items = value as unknown[];
  if (items.length > maximum) fail(path, `exceeds ${maximum} items`);
  return items.map((item, index) => parse(item, `${path}[${index}]`));
};

const uniqueArrayAt = <T extends string>(
  value: unknown,
  path: string,
  maximum: number,
  parse: (item: unknown, itemPath: string) => T,
): readonly T[] => {
  const parsed = arrayAt(value, path, maximum, parse);
  if (new Set(parsed).size !== parsed.length) fail(path, 'contains duplicate values');
  return parsed;
};

const versionOneAt = (value: unknown, path: string): 1 => {
  if (value !== 1) fail(path, 'expected version 1');
  return 1;
};

const canonicalIdAt = (value: unknown, path: string): string => {
  const parsed = stringAt(value, path, CATALOG_PIPELINE_LIMITS.maximumIdentifierLength);
  if (!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(parsed)) {
    fail(path, 'expected lowercase Firestore-safe identifier');
  }
  return parsed;
};

const stableIdentityAt = (value: unknown, path: string): string => {
  const parsed = stringAt(value, path, CATALOG_PIPELINE_LIMITS.maximumIdentifierLength);
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(parsed)) {
    fail(path, 'expected stable identifier');
  }
  return parsed;
};

const languageAt = (value: unknown, path: string): string => {
  const parsed = stringAt(value, path, 35);
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(parsed)) {
    fail(path, 'expected canonical language code');
  }
  return parsed;
};

const isoAt = (value: unknown, path: string): string => {
  const parsed = stringAt(value, path, 32);
  const timestamp = Date.parse(parsed);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== parsed) {
    fail(path, 'expected canonical ISO-8601 UTC timestamp');
  }
  return parsed;
};

const digestAt = (value: unknown, path: string): string => {
  const parsed = stringAt(value, path, 64);
  if (!/^[a-f0-9]{64}$/.test(parsed)) fail(path, 'expected lowercase SHA-256 digest');
  return parsed;
};

const relativePathAt = (value: unknown, path: string): string => {
  const parsed = stringAt(value, path, CATALOG_PIPELINE_LIMITS.maximumPathLength);
  const segments = parsed.split('/');
  if (
    parsed.startsWith('/')
    || parsed.includes('\\')
    || parsed.includes('?')
    || parsed.includes('#')
    || parsed.includes('%')
    || /^[a-z][a-z0-9+.-]*:/i.test(parsed)
    || segments.some(segment => !segment || segment === '.' || segment === '..')
  ) {
    fail(path, 'expected same-origin relative path without traversal');
  }
  return parsed;
};

const optionalHttpsUrlAt = (value: unknown, path: string): string | null => {
  if (value === null) return null;
  const parsed = stringAt(value, path, CATALOG_PIPELINE_LIMITS.maximumUrlLength);
  const url = (() => {
    try {
      return new URL(parsed);
    } catch {
      return fail(path, 'expected HTTPS URL or null');
    }
  })();
  if (url.protocol !== 'https:' || url.username || url.password) {
    fail(path, 'expected credential-free HTTPS URL or null');
  }
  return parsed;
};

export function parseCatalogSourceManifestV1(value: unknown): CatalogSourceManifestV1 {
  const record = recordAt(value, 'sourceManifest', [
    'manifestVersion', 'catalogId', 'contentLanguage', 'supportLanguages',
    'lexemeFiles', 'membershipFiles',
  ]);
  const parsed: CatalogSourceManifestV1 = {
    manifestVersion: versionOneAt(record.manifestVersion, 'sourceManifest.manifestVersion'),
    catalogId: canonicalIdAt(record.catalogId, 'sourceManifest.catalogId'),
    contentLanguage: languageAt(record.contentLanguage, 'sourceManifest.contentLanguage'),
    supportLanguages: uniqueArrayAt(
      record.supportLanguages,
      'sourceManifest.supportLanguages',
      CATALOG_PIPELINE_LIMITS.maximumSupportLanguages,
      languageAt,
    ),
    lexemeFiles: uniqueArrayAt(
      record.lexemeFiles,
      'sourceManifest.lexemeFiles',
      CATALOG_PIPELINE_LIMITS.maximumSourceFiles,
      relativePathAt,
    ),
    membershipFiles: uniqueArrayAt(
      record.membershipFiles,
      'sourceManifest.membershipFiles',
      CATALOG_PIPELINE_LIMITS.maximumSourceFiles,
      relativePathAt,
    ),
  };
  const allFiles = [...parsed.lexemeFiles, ...parsed.membershipFiles];
  if (parsed.lexemeFiles.length === 0 || parsed.membershipFiles.length === 0) {
    fail('sourceManifest', 'requires at least one lexeme file and one membership file');
  }
  if (allFiles.length > CATALOG_PIPELINE_LIMITS.maximumSourceFiles) {
    fail('sourceManifest', `exceeds ${CATALOG_PIPELINE_LIMITS.maximumSourceFiles} total files`);
  }
  if (new Set(allFiles).size !== allFiles.length) {
    fail('sourceManifest', 'a file may not appear in both source lists');
  }
  return parsed;
}

export function parseCatalogCandidateProvenanceV1(value: unknown): CatalogCandidateProvenanceV1 {
  const record = recordAt(value, 'provenance', [
    'schemaVersion', 'sourceRef', 'sourceUrl', 'licenseId', 'rightsEvidenceId', 'attribution',
    'authorId', 'origin', 'publishability', 'generator',
  ]);
  const origin = enumAt(record.origin, 'provenance.origin', [
    'human-authored', 'ai-assisted', 'imported',
  ] as const);
  const common = {
    schemaVersion: versionOneAt(record.schemaVersion, 'provenance.schemaVersion'),
    sourceRef: canonicalIdAt(record.sourceRef, 'provenance.sourceRef'),
    sourceUrl: optionalHttpsUrlAt(record.sourceUrl, 'provenance.sourceUrl'),
    licenseId: stringAt(
      record.licenseId,
      'provenance.licenseId',
      CATALOG_PIPELINE_LIMITS.maximumIdentifierLength,
    ),
    rightsEvidenceId: record.rightsEvidenceId === null
      ? null
      : stringAt(record.rightsEvidenceId, 'provenance.rightsEvidenceId', 256),
    attribution: stringAt(
      record.attribution,
      'provenance.attribution',
      CATALOG_PIPELINE_LIMITS.maximumAttributionLength,
    ),
    authorId: stableIdentityAt(record.authorId, 'provenance.authorId'),
    publishability: enumAt(record.publishability, 'provenance.publishability', [
      'non-publishable', 'review-required', 'publishable',
    ] as const),
  };
  if (origin === 'ai-assisted') {
    const generator = recordAt(record.generator, 'provenance.generator', ['provider', 'model']);
    return {
      ...common,
      origin,
      generator: {
        provider: stringAt(
          generator.provider,
          'provenance.generator.provider',
          CATALOG_PIPELINE_LIMITS.maximumIdentifierLength,
        ),
        model: stringAt(
          generator.model,
          'provenance.generator.model',
          CATALOG_PIPELINE_LIMITS.maximumIdentifierLength,
        ),
      },
    };
  }
  if (record.generator !== undefined) {
    fail('provenance.generator', 'only ai-assisted provenance may include generator evidence');
  }
  return { ...common, origin };
}

export function parseCatalogReviewEvidenceV1(value: unknown): CatalogReviewEvidenceV1 {
  const statusRecord = recordAt(value, 'review', [
    'status', 'reviewerId', 'reviewedAt', 'contentDigest',
  ]);
  const status = enumAt(statusRecord.status, 'review.status', ['unreviewed', 'reviewed'] as const);
  if (status === 'unreviewed') {
    const record = recordAt(value, 'review', ['status']);
    return { status: enumAt(record.status, 'review.status', ['unreviewed'] as const) };
  }
  return {
    status,
    reviewerId: stableIdentityAt(statusRecord.reviewerId, 'review.reviewerId'),
    reviewedAt: isoAt(statusRecord.reviewedAt, 'review.reviewedAt'),
    contentDigest: digestAt(statusRecord.contentDigest, 'review.contentDigest'),
  };
}

const countsAt = (value: unknown): CatalogReleaseCountsV1 => {
  const record = recordAt(value, 'releaseManifest.counts', [
    'lexemes', 'memberships', 'chunks', 'encodedBytes',
  ]);
  return {
    lexemes: integerAt(
      record.lexemes,
      'releaseManifest.counts.lexemes',
      CATALOG_PIPELINE_LIMITS.maximumLexemes,
    ),
    memberships: integerAt(
      record.memberships,
      'releaseManifest.counts.memberships',
      CATALOG_PIPELINE_LIMITS.maximumReleaseMemberships,
    ),
    chunks: integerAt(
      record.chunks,
      'releaseManifest.counts.chunks',
      CATALOG_PIPELINE_LIMITS.maximumChunks,
    ),
    encodedBytes: integerAt(
      record.encodedBytes,
      'releaseManifest.counts.encodedBytes',
      CATALOG_PIPELINE_LIMITS.maximumReleaseBytes,
    ),
  };
};

const chunkDescriptorAt = (value: unknown, path: string): CatalogChunkDescriptorV1 => {
  const record = recordAt(value, path, [
    'id', 'ordinal', 'path', 'sha256', 'byteLength', 'lexemeCount',
    'membershipCount', 'trackIds',
  ]);
  return {
    id: canonicalIdAt(record.id, `${path}.id`),
    ordinal: integerAt(record.ordinal, `${path}.ordinal`, CATALOG_PIPELINE_LIMITS.maximumChunks - 1),
    path: relativePathAt(record.path, `${path}.path`),
    sha256: digestAt(record.sha256, `${path}.sha256`),
    byteLength: integerAt(
      record.byteLength,
      `${path}.byteLength`,
      CATALOG_PIPELINE_LIMITS.maximumChunkBytes,
      1,
    ),
    lexemeCount: integerAt(
      record.lexemeCount,
      `${path}.lexemeCount`,
      CATALOG_PIPELINE_LIMITS.maximumLexemes,
    ),
    membershipCount: integerAt(
      record.membershipCount,
      `${path}.membershipCount`,
      CATALOG_PIPELINE_LIMITS.maximumChunkMemberships,
    ),
    trackIds: uniqueArrayAt(
      record.trackIds,
      `${path}.trackIds`,
      CATALOG_PIPELINE_LIMITS.maximumTrackIdsPerChunk,
      canonicalIdAt,
    ),
  };
};

export function parseCatalogReleaseManifestV1(value: unknown): CatalogReleaseManifestV1 {
  const record = recordAt(value, 'releaseManifest', [
    'manifestVersion', 'catalogId', 'releaseId', 'sequence', 'contentLanguage', 'supportLanguages',
    'createdAt', 'previousReleaseId', 'counts', 'chunks',
  ]);
  const counts = countsAt(record.counts);
  const chunks = arrayAt(
    record.chunks,
    'releaseManifest.chunks',
    CATALOG_PIPELINE_LIMITS.maximumChunks,
    chunkDescriptorAt,
  );
  chunks.forEach((chunk, index) => {
    if (chunk.ordinal !== index) fail(`releaseManifest.chunks[${index}].ordinal`, 'must be contiguous');
  });
  if (new Set(chunks.map(chunk => chunk.id)).size !== chunks.length) {
    fail('releaseManifest.chunks', 'contains duplicate ids');
  }
  if (new Set(chunks.map(chunk => chunk.path)).size !== chunks.length) {
    fail('releaseManifest.chunks', 'contains duplicate paths');
  }
  const summed = chunks.reduce((total, chunk) => ({
    lexemes: total.lexemes + chunk.lexemeCount,
    memberships: total.memberships + chunk.membershipCount,
    encodedBytes: total.encodedBytes + chunk.byteLength,
  }), { lexemes: 0, memberships: 0, encodedBytes: 0 });
  if (counts.chunks !== chunks.length) fail('releaseManifest.counts.chunks', 'does not match chunks');
  if (counts.lexemes !== summed.lexemes) fail('releaseManifest.counts.lexemes', 'does not match chunks');
  if (counts.memberships !== summed.memberships) fail('releaseManifest.counts.memberships', 'does not match chunks');
  if (counts.encodedBytes !== summed.encodedBytes) {
    fail('releaseManifest.counts.encodedBytes', 'does not match chunks');
  }
  return {
    manifestVersion: versionOneAt(record.manifestVersion, 'releaseManifest.manifestVersion'),
    catalogId: canonicalIdAt(record.catalogId, 'releaseManifest.catalogId'),
    releaseId: canonicalIdAt(record.releaseId, 'releaseManifest.releaseId'),
    sequence: integerAt(record.sequence, 'releaseManifest.sequence', Number.MAX_SAFE_INTEGER, 1),
    contentLanguage: languageAt(record.contentLanguage, 'releaseManifest.contentLanguage'),
    supportLanguages: uniqueArrayAt(
      record.supportLanguages,
      'releaseManifest.supportLanguages',
      CATALOG_PIPELINE_LIMITS.maximumSupportLanguages,
      languageAt,
    ),
    createdAt: isoAt(record.createdAt, 'releaseManifest.createdAt'),
    previousReleaseId: record.previousReleaseId === null
      ? null
      : canonicalIdAt(record.previousReleaseId, 'releaseManifest.previousReleaseId'),
    counts,
    chunks,
  };
}

export interface ParseCatalogChunkV1Options {
  readonly expectedReleaseId: string;
  readonly expectedOrdinal: number;
  readonly expectedLexemeCount: number;
  readonly expectedMembershipCount: number;
}

export function parseCatalogChunkV1(
  value: unknown,
  options: ParseCatalogChunkV1Options,
): CatalogChunkV1 {
  const record = recordAt(value, 'chunk', [
    'formatVersion', 'releaseId', 'ordinal', 'lexemes', 'memberships',
  ]);
  const releaseId = canonicalIdAt(record.releaseId, 'chunk.releaseId');
  const ordinal = integerAt(record.ordinal, 'chunk.ordinal', CATALOG_PIPELINE_LIMITS.maximumChunks - 1);
  const lexemes = arrayAt(
    record.lexemes,
    'chunk.lexemes',
    CATALOG_PIPELINE_LIMITS.maximumLexemes,
    item => parseLexemeV3(item),
  );
  const memberships = arrayAt(
    record.memberships,
    'chunk.memberships',
    CATALOG_PIPELINE_LIMITS.maximumChunkMemberships,
    item => parseTrackMembershipV3(item),
  );
  if (releaseId !== options.expectedReleaseId) fail('chunk.releaseId', 'does not match descriptor');
  if (ordinal !== options.expectedOrdinal) fail('chunk.ordinal', 'does not match descriptor');
  if (lexemes.length !== options.expectedLexemeCount) fail('chunk.lexemes', 'count does not match descriptor');
  if (memberships.length !== options.expectedMembershipCount) {
    fail('chunk.memberships', 'count does not match descriptor');
  }
  return {
    formatVersion: versionOneAt(record.formatVersion, 'chunk.formatVersion'),
    releaseId,
    ordinal,
    lexemes,
    memberships,
  };
}

const lexemeCandidateAt = (value: unknown): CatalogLexemeCandidateV1 => {
  const record = recordAt(value, 'candidate', ['entity', 'provenance', 'review']);
  const entity = parseLexemeV3(record.entity);
  const provenance = parseCatalogCandidateProvenanceV1(record.provenance);
  const review = parseCatalogReviewEvidenceV1(record.review);
  if (entity.provenance.source !== provenance.sourceRef) {
    fail('candidate.entity.provenance.source', 'does not match candidate sourceRef');
  }
  if (entity.provenance.license !== provenance.licenseId) {
    fail('candidate.entity.provenance.license', 'does not match candidate licenseId');
  }
  const expectedReviewer = review.status === 'reviewed' ? review.reviewerId : 'unreviewed';
  if (entity.provenance.reviewer !== expectedReviewer) {
    fail('candidate.entity.provenance.reviewer', 'does not match review evidence');
  }
  return { entity, provenance, review };
};

const membershipCandidateAt = (value: unknown): CatalogMembershipCandidateV1 => {
  const record = recordAt(value, 'candidate', ['entity', 'provenance', 'review']);
  return {
    entity: parseTrackMembershipV3(record.entity),
    provenance: parseCatalogCandidateProvenanceV1(record.provenance),
    review: parseCatalogReviewEvidenceV1(record.review),
  };
};

const issueFrom = (
  code: CatalogIssue['code'],
  path: string,
  error: unknown,
): CatalogIssue => ({
  code,
  path,
  message: error instanceof Error ? error.message : String(error),
});

const lexemeIdentityKey = (value: LexemeV3): string => {
  const identity = canonicalizeLexemeIdentity(value);
  return JSON.stringify([
    identity.language,
    identity.normalizedLemma,
    identity.partOfSpeech,
    identity.senseKey,
  ]);
};

const membershipIdentityKey = (value: TrackMembershipV3): string => {
  const identity = canonicalizeTrackMembershipIdentity(value);
  return JSON.stringify([identity.trackId, identity.lexemeId]);
};

const duplicateIssues = <T>(
  items: readonly T[],
  idOf: (item: T) => string,
  identityOf: (item: T) => string,
  kind: 'lexeme' | 'membership',
): readonly CatalogIssue[] => {
  const issues: CatalogIssue[] = [];
  const ids = new Set<string>();
  const identities = new Set<string>();
  items.forEach((item, index) => {
    const id = idOf(item);
    if (ids.has(id)) issues.push({
      code: `duplicate-${kind}-id`,
      path: `${kind}s[${index}].entity.id`,
      message: `duplicate ${kind} id ${id}`,
    });
    ids.add(id);
    const identity = identityOf(item);
    if (identities.has(identity)) issues.push({
      code: `duplicate-${kind}-identity`,
      path: `${kind}s[${index}].entity`,
      message: `duplicate canonical ${kind} identity`,
    });
    identities.add(identity);
  });
  return issues;
};

export interface ValidateCatalogSourceBundleOptions {
  readonly requireEnglishPilotCounts?: boolean;
}

export function validateCatalogSourceBundle(
  value: unknown,
  options: ValidateCatalogSourceBundleOptions = {},
): CatalogValidationResult {
  const issues: CatalogIssue[] = [];
  let root: UnknownRecord;
  try {
    root = recordAt(value, 'catalog', ['manifest', 'lexemes', 'memberships']);
  } catch (error) {
    return { status: 'quarantined', issues: [issueFrom('invalid-manifest', 'catalog', error)] };
  }

  let manifest: CatalogSourceManifestV1 | null = null;
  try {
    manifest = parseCatalogSourceManifestV1(root.manifest);
  } catch (error) {
    issues.push(issueFrom('invalid-manifest', 'manifest', error));
  }

  const lexemes: CatalogLexemeCandidateV1[] = [];
  if (!Array.isArray(root.lexemes) || root.lexemes.length > CATALOG_PIPELINE_LIMITS.maximumLexemes) {
    issues.push({ code: 'invalid-lexeme', path: 'lexemes', message: 'expected bounded lexeme array' });
  } else {
    root.lexemes.forEach((candidate, index) => {
      try {
        lexemes.push(lexemeCandidateAt(candidate));
      } catch (error) {
        issues.push(issueFrom('invalid-lexeme', `lexemes[${index}]`, error));
      }
    });
  }

  const memberships: CatalogMembershipCandidateV1[] = [];
  if (
    !Array.isArray(root.memberships)
    || root.memberships.length > CATALOG_PIPELINE_LIMITS.maximumReleaseMemberships
  ) {
    issues.push({
      code: 'invalid-membership',
      path: 'memberships',
      message: 'expected bounded membership array',
    });
  } else {
    root.memberships.forEach((candidate, index) => {
      try {
        memberships.push(membershipCandidateAt(candidate));
      } catch (error) {
        issues.push(issueFrom('invalid-membership', `memberships[${index}]`, error));
      }
    });
  }

  issues.push(...duplicateIssues(
    lexemes.map(candidate => candidate.entity),
    item => item.id,
    lexemeIdentityKey,
    'lexeme',
  ));
  issues.push(...duplicateIssues(
    memberships.map(candidate => candidate.entity),
    item => item.id,
    membershipIdentityKey,
    'membership',
  ));

  const lexemeIds = new Set(lexemes.map(candidate => candidate.entity.id));
  if (manifest !== null) {
    lexemes.forEach((candidate, index) => {
      if (candidate.entity.language !== manifest.contentLanguage) issues.push({
        code: 'lexeme-language-mismatch',
        path: `lexemes[${index}].entity.language`,
        message: `expected manifest content language ${manifest.contentLanguage}`,
      });
    });
  }
  memberships.forEach((candidate, index) => {
    if (!lexemeIds.has(candidate.entity.lexemeId)) issues.push({
      code: 'missing-lexeme-reference',
      path: `memberships[${index}].entity.lexemeId`,
      message: `missing lexeme ${candidate.entity.lexemeId}`,
    });
  });

  if (options.requireEnglishPilotCounts) {
    for (const trackId of ['ielts', 'toeic', 'general'] as const) {
      const count = memberships.filter(candidate => candidate.entity.trackId === trackId).length;
      if (count !== 300) issues.push({
        code: 'pilot-count',
        path: `memberships.${trackId}`,
        message: `expected exactly 300 ${trackId} memberships, received ${count}`,
      });
    }
  }

  if (issues.length > 0 || manifest === null) return { status: 'quarantined', issues };
  return { status: 'accepted', catalog: { manifest, lexemes, memberships } };
}
