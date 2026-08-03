export type FirestoreDocumentIdentityKind = 'ownerId' | 'lexemeId' | 'sourceDocumentId';

export const assertFirestoreDocumentSegment = (
  value: string,
  kind: FirestoreDocumentIdentityKind,
): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 128
    || value.includes('/')
    || value === '.'
    || value === '..'
    || /^__.*__$/.test(value)
    || (kind === 'lexemeId' && !/^[a-zA-Z0-9_-]+$/.test(value))
  ) {
    throw new TypeError(`${kind}: invalid Firestore document segment`);
  }
  return value;
};
