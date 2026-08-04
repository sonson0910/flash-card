import type {
  CatalogSourceBundleV1,
} from './catalogContracts';
import { createEnglishPilotCatalog } from './pilotCatalog';

const belongsToTrack = (candidate: CatalogSourceBundleV1['memberships'][number]): boolean => {
  const rankWithinTier = candidate.entity.rank % 100;
  if (candidate.entity.trackId === 'ielts') return rankWithinTier < 50;
  if (candidate.entity.trackId === 'toeic') return rankWithinTier >= 50 && rankWithinTier < 80;
  return rankWithinTier >= 80;
};

export function createEnglishStarterCatalogDraft(): CatalogSourceBundleV1 {
  const pilot = createEnglishPilotCatalog();
  return {
    manifest: {
      manifestVersion: 1,
      catalogId: 'english-core',
      contentLanguage: 'en',
      supportLanguages: ['vi'],
      lexemeFiles: ['starter/english-lexemes.jsonl'],
      membershipFiles: ['starter/english-memberships.jsonl'],
    },
    lexemes: pilot.lexemes,
    memberships: pilot.memberships.filter(belongsToTrack),
  };
}
