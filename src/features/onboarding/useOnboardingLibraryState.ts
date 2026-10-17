import { useEffect, useState } from 'react';
import { db } from '../../lib/firebase';
import type { CloudLibraryPageSnapshot } from '../librarySession/cloudLibraryPageController';

type LibraryCloud = Pick<CloudLibraryPageSnapshot,
  'ownerId' | 'isLoading' | 'cloudUnavailable' | 'items' | 'total' | 'stats'>;
type OwnerCount = { ownerId: string; count: number };

export function onboardingLibraryState(ownerId: string | null, cloud: LibraryCloud, ownerCount: OwnerCount | null = null) {
  const ownerCloud = Boolean(ownerId && cloud.ownerId === ownerId);
  const cloudHasCards = ownerCloud && Math.max(cloud.total, cloud.stats.total, cloud.items.length) > 0;
  const countedOwner = Boolean(ownerId && ownerCount?.ownerId === ownerId);
  return {
    libraryReady: ownerCloud && !cloud.isLoading && !cloud.cloudUnavailable && (cloudHasCards || countedOwner),
    hasCards: cloudHasCards || (countedOwner && ownerCount!.count > 0),
  };
}

export function useOnboardingLibraryState({ ownerId, cloud, needsOnboarding, canClassify }: {
  ownerId: string | null;
  cloud: LibraryCloud;
  needsOnboarding: boolean;
  canClassify: boolean;
}) {
  const [ownerCount, setOwnerCount] = useState<OwnerCount | null>(null);
  const library = onboardingLibraryState(ownerId, cloud, ownerCount);

  useEffect(() => {
    if (!canClassify) {
      setOwnerCount(null);
      return;
    }
    const database = db;
    if (!ownerId || !needsOnboarding || !database || cloud.ownerId !== ownerId
      || cloud.isLoading || cloud.cloudUnavailable || library.libraryReady) return;
    let active = true;
    let request = 0;
    const countOwnerCards = () => {
      const currentRequest = ++request;
      void import('../../lib/cardRepository').then(({ countCards }) => countCards(database, ownerId, {
        category: null, customDeck: { kind: 'all' }, difficulty: null, partOfSpeech: null,
        bookmarkedOnly: false, createdDate: null, wordPrefix: '', targetLanguage: null,
      })).then(count => {
        if (active && currentRequest === request) setOwnerCount({ ownerId, count });
      }).catch(() => { /* Wait for a confirmed owner-wide result before starting onboarding. */ });
    };
    countOwnerCards();
    window.addEventListener('online', countOwnerCards);
    return () => {
      active = false;
      window.removeEventListener('online', countOwnerCards);
    };
  }, [ownerId, needsOnboarding, canClassify, cloud.ownerId,
    cloud.isLoading, cloud.cloudUnavailable, library.libraryReady]);

  return library;
}
