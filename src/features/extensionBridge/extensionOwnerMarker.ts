// An opaque, stable marker of the signed-in account for the browser extension.
//
// The extension's sync scopes are random per app document, so it cannot tell
// a reload, a second tab or a course switch of the same learner from another
// learner signing in on the same browser. It keeps the learner's saved-word
// history and retry receipts only while the marker stays the same. The marker
// is a one-way hash of the owner id: equal for the same account in every tab,
// different for another account, and never the owner id itself. The value fits
// the extension's scope pattern, [A-Za-z0-9_-]{8,128}.
const MARKER_SALT = 'lingoflash-extension-owner:';

// cyrb53, a small 53-bit string hash. Two seeds give a 106-bit marker.
const hash53 = (value: string, seed: number): number => {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
};

export const extensionOwnerMarkerFor = (ownerId: string): string => {
  const source = `${MARKER_SALT}${ownerId}`;
  return `o_${hash53(source, 0).toString(36)}${hash53(source, 1).toString(36)}`;
};
