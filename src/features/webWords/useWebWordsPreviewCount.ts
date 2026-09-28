import { useEffect, useState } from 'react';
import { db } from '../../lib/firebase';
import { fetchWebWordsPage } from './webWordsQuery';

export const STRIP_PREVIEW_COUNT = 5;

/** Counts one active course's newest web captures, capped at one bounded page with no lookahead read. */
export function useWebWordsPreviewCount(ownerId: string | null, targetLanguage: string | null): number {
  const [previewCount, setPreviewCount] = useState(0);

  useEffect(() => {
    let retired = false;
    setPreviewCount(0);
    if (!ownerId || !targetLanguage || !db) return () => { retired = true; };

    fetchWebWordsPage({
      db,
      ownerId,
      targetLanguage,
      pageSize: STRIP_PREVIEW_COUNT,
      detectHasNext: false,
    })
      .then(page => { if (!retired) setPreviewCount(page.items.length); })
      .catch(() => { if (!retired) setPreviewCount(0); });

    return () => { retired = true; };
  }, [ownerId, targetLanguage]);

  return previewCount;
}
