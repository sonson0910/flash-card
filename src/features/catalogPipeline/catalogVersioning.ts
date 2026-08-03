export interface CatalogVersionIdentity {
  readonly contentVersion: number;
  readonly contentFingerprint: string;
}

export type CatalogVersionDecision =
  | { readonly status: 'create' }
  | { readonly status: 'advance' }
  | { readonly status: 'unchanged' }
  | {
      readonly status: 'conflict';
      readonly reason:
        | 'invalid-current-version'
        | 'invalid-incoming-version'
        | 'invalid-current-fingerprint'
        | 'invalid-incoming-fingerprint'
        | 'initial-version-must-be-one'
        | 'stale-version'
        | 'version-gap'
        | 'immutable-version-mismatch'
        | 'empty-version-bump';
    };

const validVersion = (value: number): boolean => Number.isSafeInteger(value) && value >= 1;
const validFingerprint = (value: string): boolean => /^sha256:[0-9a-f]{64}$/.test(value);

export const decideCatalogVersion = (
  current: CatalogVersionIdentity | null,
  incoming: CatalogVersionIdentity,
): CatalogVersionDecision => {
  if (current !== null && !validVersion(current.contentVersion)) {
    return { status: 'conflict', reason: 'invalid-current-version' };
  }
  if (!validVersion(incoming.contentVersion)) {
    return { status: 'conflict', reason: 'invalid-incoming-version' };
  }
  if (current !== null && !validFingerprint(current.contentFingerprint)) {
    return { status: 'conflict', reason: 'invalid-current-fingerprint' };
  }
  if (!validFingerprint(incoming.contentFingerprint)) {
    return { status: 'conflict', reason: 'invalid-incoming-fingerprint' };
  }
  if (current === null) {
    return incoming.contentVersion === 1
      ? { status: 'create' }
      : { status: 'conflict', reason: 'initial-version-must-be-one' };
  }
  if (incoming.contentVersion < current.contentVersion) {
    return { status: 'conflict', reason: 'stale-version' };
  }
  if (incoming.contentVersion === current.contentVersion) {
    return incoming.contentFingerprint === current.contentFingerprint
      ? { status: 'unchanged' }
      : { status: 'conflict', reason: 'immutable-version-mismatch' };
  }
  if (incoming.contentVersion > current.contentVersion + 1) {
    return { status: 'conflict', reason: 'version-gap' };
  }
  if (incoming.contentFingerprint === current.contentFingerprint) {
    return { status: 'conflict', reason: 'empty-version-bump' };
  }
  return { status: 'advance' };
};
