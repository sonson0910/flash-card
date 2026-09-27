import type { RefObject } from 'react';
import { msg } from '@lingui/core/macro';
import type { PersonalLibraryPathPresentation } from './personalLibraryPaths';

export type CatalogAvailabilityStatus =
  | { kind: 'checking'; message: string }
  | { kind: 'personal'; message: string }
  | { kind: 'unavailable'; isOnline: boolean; canDownload: boolean; message: string }
  | { kind: 'downloading'; progressPercent: number; message: string }
  | { kind: 'ready'; isOnline: boolean; message: string }
  | { kind: 'error'; isOnline: boolean; message: string; detail?: string };

export interface CatalogLanguageOption {
  code: string;
  label: string;
  nativeLabel: string;
  isAvailable: boolean;
}

/** IDs are stable across catalogs; only the three available IDs are rendered today. */
export type CatalogTrackId = 'ielts' | 'toeic' | 'general' | 'topik' | 'jlpt' | 'hsk';
export type AvailableCatalogTrackId = Extract<CatalogTrackId, 'ielts' | 'toeic' | 'general'>;

export const catalogTrackMessages = {
  ielts: {
    label: msg({ id: 'paths.track.ielts.label', message: 'IELTS' }),
    description: msg({ id: 'paths.track.ielts.description', message: 'Academic and general test vocabulary' }),
  },
  toeic: {
    label: msg({ id: 'paths.track.toeic.label', message: 'TOEIC' }),
    description: msg({ id: 'paths.track.toeic.description', message: 'Workplace and business vocabulary' }),
  },
  general: {
    label: msg({ id: 'paths.track.general.label', message: 'General English' }),
    description: msg({ id: 'paths.track.general.description', message: 'Everyday communication vocabulary' }),
  },
} satisfies Record<AvailableCatalogTrackId, { label: ReturnType<typeof msg>; description: ReturnType<typeof msg> }>;

export const catalogTierMessages = {
  foundation: {
    label: msg({ id: 'paths.tier.foundation.label', message: 'Foundation' }),
    description: msg({ id: 'paths.tier.foundation.description', message: 'Build essential language from A1 to A2.' }),
  },
  core: {
    label: msg({ id: 'paths.tier.core.label', message: 'Core' }),
    description: msg({ id: 'paths.tier.core.description', message: 'Grow a confident working range from B1 to B2.' }),
  },
  advanced: {
    label: msg({ id: 'paths.tier.advanced.label', message: 'Advanced' }),
    description: msg({ id: 'paths.tier.advanced.description', message: 'Use precise and nuanced language from C1 to C2.' }),
  },
} as const;

export interface CatalogTrackPresentation {
  id: AvailableCatalogTrackId;
  label: string;
  description: string;
  total: number;
  started: number;
  mastered: number;
}

export type CatalogTierState = 'available' | 'in-progress' | 'completed' | 'locked';

export interface CatalogTierPresentation {
  id: 'foundation' | 'core' | 'advanced';
  label: string;
  description: string;
  cefrRange?: string;
  total: number;
  started: number;
  mastered: number;
  state: CatalogTierState;
}

export interface CatalogFilterOption {
  value: string;
  label: string;
}

export interface CatalogFilterPresentation {
  term: string;
  cefr: string;
  topic: string;
  partOfSpeech: string;
  skill: string;
  cefrOptions: CatalogFilterOption[];
  topicOptions: CatalogFilterOption[];
  partOfSpeechOptions: CatalogFilterOption[];
  skillOptions: CatalogFilterOption[];
  hasActiveFilters: boolean;
}

export interface CatalogVocabularyPresentation {
  id: string;
  lexemeId?: string;
  lemma: string;
  normalizedLemma?: string;
  language: string;
  senseKey?: string;
  phonetic?: string;
  partOfSpeech: string;
  cefr: string;
  tier: string;
  topics: string[];
  skills: string[];
  meaning: string;
  meaningLanguage: string;
  translation?: string;
  translationLanguage?: string;
  example?: string;
  exampleTranslation?: string;
  collocations: string[];
  provenance: {
    sourceLabel: string;
    licenseLabel: string;
    reviewerLabel: string;
  };
  libraryState?: 'available' | 'adding' | 'added' | 'failed';
}

export interface CatalogScreenModel {
  headingRef?: RefObject<HTMLHeadingElement | null>;
  status: CatalogAvailabilityStatus;
  selectedLanguage: string;
  languages: CatalogLanguageOption[];
  selectedTrack: CatalogTrackPresentation['id'];
  tracks: CatalogTrackPresentation[];
  selectedTier: CatalogTierPresentation['id'];
  tiers: CatalogTierPresentation[];
  filters: CatalogFilterPresentation;
  cards: CatalogVocabularyPresentation[];
  resultSummary: string;
  hasMore: boolean;
  isLoadingPage: boolean;
  isLoadingMore: boolean;
  personalLibrary?: PersonalLibraryPathPresentation;
}

export interface CatalogScreenActions {
  selectLanguage: (language: string) => void;
  selectTrack: (track: CatalogTrackPresentation['id']) => void;
  selectTier: (tier: CatalogTierPresentation['id']) => void;
  changeTerm: (term: string) => void;
  changeCefr: (cefr: string) => void;
  changeTopic: (topic: string) => void;
  changePartOfSpeech: (partOfSpeech: string) => void;
  changeSkill: (skill: string) => void;
  resetFilters: () => void;
  download: () => void;
  retry: () => void;
  loadMore: () => void;
  addToLibrary: (cardId: string) => void;
  openVocabulary: () => void;
  continueReview: () => void;
}
