import { useEffect, useState } from 'react';
import { db } from '../../lib/firebase';
import { fetchWebWordsPage } from './webWordsQuery';

export const STRIP_PREVIEW_COUNT = 5;

export interface WebWordsPreviewCount {
  readonly count: number;
  readonly isAtCap: boolean;
}

/** Counts one active course's newest web captures, capped at one bounded page with no lookahead read. */
export function useWebWordsPreviewCount(ownerId: string | null, targetLanguage: string | null, translationLanguage: string | null): WebWordsPreviewCount {
  const [preview, setPreview] = useState<WebWordsPreviewCount>({ count: 0, isAtCap: false });

  useEffect(() => {
    let retired = false;
    setPreview({ count: 0, isAtCap: false });
    if (!ownerId || !targetLanguage || !translationLanguage || !db) return () => { retired = true; };

    fetchWebWordsPage({
      db,
      ownerId,
      targetLanguage,
      translationLanguage,
      pageSize: STRIP_PREVIEW_COUNT,
      detectHasNext: false,
    })
      .then(page => {
        if (!retired) setPreview({ count: page.items.length, isAtCap: page.scannedCount >= STRIP_PREVIEW_COUNT });
      })
      .catch(() => { if (!retired) setPreview({ count: 0, isAtCap: false }); });

    return () => { retired = true; };
  }, [ownerId, targetLanguage, translationLanguage]);

  return preview;
}
