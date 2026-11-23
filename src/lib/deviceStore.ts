const safeProtocolNumber = (value: unknown): number =>
  Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;

/** Orders two stored cards by library epoch, then revision; a missing or malformed value counts as 0. */
export function compareStoredCardVersions(left: unknown, right: unknown): number {
  const leftCard = left && typeof left === 'object' ? left as Record<string, unknown> : {};
  const rightCard = right && typeof right === 'object' ? right as Record<string, unknown> : {};
  const leftEpoch = safeProtocolNumber(leftCard.libraryEpoch);
  const rightEpoch = safeProtocolNumber(rightCard.libraryEpoch);
  if (leftEpoch !== rightEpoch) return leftEpoch < rightEpoch ? -1 : 1;
  const leftRevision = safeProtocolNumber(leftCard.revision);
  const rightRevision = safeProtocolNumber(rightCard.revision);
  if (leftRevision === rightRevision) return 0;
  return leftRevision < rightRevision ? -1 : 1;
}
