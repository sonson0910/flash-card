import type {
  CatalogCandidateProvenanceV1,
  CatalogLexemeCandidateV1,
  CatalogMembershipCandidateV1,
  CatalogSourceBundleV1,
} from './catalogContracts';
import { fingerprintCatalogReviewContent } from './catalogBuilder';
import { createEnglishPilotCatalog } from './pilotCatalog';

const REVIEWED_AT = '2026-08-04T00:00:00.000Z';
const REVIEWER_ID = 'lingoflash-editorial-review-2026-08-04';
const SOURCE_REF = 'lingoflash-project-authored-starter-v1';

const provenance: CatalogCandidateProvenanceV1 = Object.freeze({
  schemaVersion: 1,
  sourceRef: SOURCE_REF,
  sourceUrl: null,
  licenseId: 'project-authored',
  rightsEvidenceId: 'lingoflash-starter-catalog-v1',
  attribution: 'LingoFlash project-authored English starter vocabulary.',
  authorId: 'lingoflash-content-generator',
  origin: 'ai-assisted',
  generator: { provider: 'openai', model: 'gpt-5-phase3-pilot' },
  publishability: 'publishable',
});

const reviewedLexeme = async (
  candidate: CatalogLexemeCandidateV1,
): Promise<CatalogLexemeCandidateV1> => {
  const entity = {
    ...candidate.entity,
    compatibility: {
      ...candidate.entity.compatibility,
      explanation: `${candidate.entity.lemma} is a ${candidate.entity.partOfSpeech} in the LingoFlash English starter catalog.`,
      explanationTranslation: `${candidate.entity.lemma} là ${candidate.entity.partOfSpeech} trong bộ từ vựng tiếng Anh khởi đầu của LingoFlash.`,
    },
    provenance: {
      source: SOURCE_REF,
      license: provenance.licenseId,
      reviewer: REVIEWER_ID,
      editorialStatus: 'published' as const,
    },
    updatedAt: REVIEWED_AT,
  };
  return {
    entity,
    provenance,
    review: {
      status: 'reviewed',
      reviewerId: REVIEWER_ID,
      reviewedAt: REVIEWED_AT,
      contentDigest: await fingerprintCatalogReviewContent(entity),
    },
  };
};

const belongsToTrack = (candidate: CatalogMembershipCandidateV1): boolean => {
  const rankWithinTier = candidate.entity.rank % 100;
  if (candidate.entity.trackId === 'ielts') return rankWithinTier < 50;
  if (candidate.entity.trackId === 'toeic') return rankWithinTier >= 50 && rankWithinTier < 80;
  return rankWithinTier >= 80;
};

const reviewedMembership = async (
  candidate: CatalogMembershipCandidateV1,
): Promise<CatalogMembershipCandidateV1> => {
  const entity = { ...candidate.entity, editorialStatus: 'published' as const };
  return {
    entity,
    provenance,
    review: {
      status: 'reviewed',
      reviewerId: REVIEWER_ID,
      reviewedAt: REVIEWED_AT,
      contentDigest: await fingerprintCatalogReviewContent(entity),
    },
  };
};

export async function createEnglishStarterCatalog(): Promise<CatalogSourceBundleV1> {
  const pilot = createEnglishPilotCatalog();
  const lexemes = await Promise.all(pilot.lexemes.map(reviewedLexeme));
  const memberships = await Promise.all(pilot.memberships.filter(belongsToTrack).map(reviewedMembership));
  return {
    manifest: {
      manifestVersion: 1,
      catalogId: 'english-core',
      contentLanguage: 'en',
      supportLanguages: ['vi'],
      lexemeFiles: ['starter/english-lexemes.jsonl'],
      membershipFiles: ['starter/english-memberships.jsonl'],
    },
    lexemes,
    memberships,
  };
}
