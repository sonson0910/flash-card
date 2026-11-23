import { describe, expect, it } from 'vitest';
import { compareStoredCardVersions } from './deviceStore';

describe('compareStoredCardVersions', () => {
  it('orders by library epoch before revision', () => {
    expect(compareStoredCardVersions({ libraryEpoch: 2, revision: 99 }, { libraryEpoch: 3, revision: 1 })).toBe(-1);
    expect(compareStoredCardVersions({ libraryEpoch: 3, revision: 1 }, { libraryEpoch: 2, revision: 99 })).toBe(1);
  });

  it('orders by revision inside one epoch and reports equal versions as 0', () => {
    expect(compareStoredCardVersions({ libraryEpoch: 2, revision: 6 }, { libraryEpoch: 2, revision: 7 })).toBe(-1);
    expect(compareStoredCardVersions({ libraryEpoch: 2, revision: 7 }, { libraryEpoch: 2, revision: 6 })).toBe(1);
    expect(compareStoredCardVersions({ libraryEpoch: 2, revision: 7 }, { libraryEpoch: 2, revision: 7 })).toBe(0);
  });

  it('treats missing, negative or malformed protocol numbers as zero', () => {
    expect(compareStoredCardVersions({}, null)).toBe(0);
    expect(compareStoredCardVersions({ libraryEpoch: -1, revision: 'x' }, { libraryEpoch: 0, revision: 0 })).toBe(0);
    expect(compareStoredCardVersions(undefined, { revision: 1 })).toBe(-1);
  });
});
