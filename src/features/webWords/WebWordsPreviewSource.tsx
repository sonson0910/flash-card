import type { ReactNode } from 'react';
import { useWebWordsPreview, type WebWordsPreview } from './useWebWordsPreview';

/**
 * Lazy data boundary for Today: it owns the Firestore read so the Today screen
 * can render the newest web captures without importing Firebase eagerly.
 */
export function WebWordsPreviewSource({ ownerId, targetLanguage, translationLanguage, children }: {
  readonly ownerId: string | null;
  readonly targetLanguage: string | null;
  readonly translationLanguage: string | null;
  readonly children: (preview: WebWordsPreview) => ReactNode;
}) {
  const preview = useWebWordsPreview(ownerId, targetLanguage, translationLanguage);
  return <>{children(preview)}</>;
}

export default WebWordsPreviewSource;
