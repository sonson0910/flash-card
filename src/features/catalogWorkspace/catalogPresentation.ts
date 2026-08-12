import type { RefObject } from 'react';
import type { PersonalLibraryPathPresentation } from './personalLibraryPaths';

export type CatalogAvailabilityStatus =
  | { kind: 'checking'; message: string }
  | { kind: 'personal'; message: string }
  | { kind: 'unavailable'; isOnline: boolean; canDownload: boolean; message: string }
  | { kind: 'downloading'; progressPercent: number; message: string }
  | { kind: 'ready'; isOnline: boolean; isAvailableOffline: boolean; message: string }
  | { kind: 'error'; isOnline: boolean; message: string; detail?: string };

export interface CatalogLanguageOption {
  code: string;
  label: string;
  nativeLabel: string;
  isAvailable: boolean;
}

export interface CatalogTrackPresentation {
  id: 'ielts' | 'toeic' | 'general';
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
  lemma: string;
  language: string;
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
