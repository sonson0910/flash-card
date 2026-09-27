import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../../lib/firebase';
import { LEGACY_CARD_LANGUAGE } from '../../types/card';
import { fetchWebWordsPage } from './webWordsQuery';

export const STRIP_PREVIEW_COUNT = 5;

/** Counts the signed-in owner's newest web captures, capped at one bounded page with no lookahead read. */
export function useWebWordsPreviewCount(): number {
  const [previewCount, setPreviewCount] = useState(0);

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, user => {
      if (!user || !db) {
        setPreviewCount(0);
        return;
      }
      fetchWebWordsPage({
        db,
        ownerId: user.uid,
        targetLanguage: LEGACY_CARD_LANGUAGE,
        pageSize: STRIP_PREVIEW_COUNT,
        detectHasNext: false,
      })
        .then(page => setPreviewCount(page.items.length))
        .catch(() => setPreviewCount(0));
    });
  }, []);

  return previewCount;
}
