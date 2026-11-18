import { useEffect, useState } from 'react';
import type { CardData } from '../../types/card';
import { db } from '../../lib/firebase';
import { fetchWebWordsPage } from './webWordsQuery';

export const WEB_WORDS_PREVIEW_COUNT = 5;

export interface WebWordsPreview {
  readonly items: readonly CardData[];
  /** True when the bounded page was full, so more captures may exist. */
  readonly isAtCap: boolean;
}

const EMPTY_PREVIEW: WebWordsPreview = { items: [], isAtCap: false };

/** Reads one active course's newest web captures, capped at one bounded page with no lookahead read. */
export function useWebWordsPreview(ownerId: string | null, targetLanguage: string | null, translationLanguage: string | null): WebWordsPreview {
  const [preview, setPreview] = useState<WebWordsPreview>(EMPTY_PREVIEW);

  useEffect(() => {
    let retired = false;
    setPreview(EMPTY_PREVIEW);
    if (!ownerId || !targetLanguage || !translationLanguage || !db) return () => { retired = true; };

    fetchWebWordsPage({
      db,
      ownerId,
      targetLanguage,
      translationLanguage,
      pageSize: WEB_WORDS_PREVIEW_COUNT,
      detectHasNext: false,
    })
      .then(page => {
        if (!retired) setPreview({ items: page.items, isAtCap: page.scannedCount >= WEB_WORDS_PREVIEW_COUNT });
      })
      .catch(() => { if (!retired) setPreview(EMPTY_PREVIEW); });

    return () => { retired = true; };
  }, [ownerId, targetLanguage, translationLanguage]);

  return preview;
}
