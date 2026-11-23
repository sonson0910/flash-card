import { describe, expect, it } from 'vitest';
import { extensionOwnerMarkerFor } from './extensionOwnerMarker';

describe('extensionOwnerMarkerFor', () => {
  it('is the same for one account and different for another', () => {
    expect(extensionOwnerMarkerFor('owner-a')).toBe(extensionOwnerMarkerFor('owner-a'));
    expect(extensionOwnerMarkerFor('owner-a')).not.toBe(extensionOwnerMarkerFor('owner-b'));
  });

  it('fits the extension scope pattern and does not contain the owner id', () => {
    const marker = extensionOwnerMarkerFor('Zk3pQ9vXyLw0aBcD7eFgHiJkLmN1');
    expect(marker).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
    expect(marker).not.toContain('Zk3pQ9vXyLw0aBcD7eFgHiJkLmN1');
  });
});
