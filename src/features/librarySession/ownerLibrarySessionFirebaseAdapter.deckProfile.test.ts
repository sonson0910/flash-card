import type { Firestore } from 'firebase/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type SnapshotListener = (snapshot: {
  exists: () => boolean;
  data: () => unknown;
  metadata: { fromCache: boolean };
}) => void;

const firestore = vi.hoisted(() => ({
  listener: null as null | { next: SnapshotListener; options: unknown },
}));

vi.mock('firebase/firestore', async importOriginal => ({
  ...(await importOriginal<typeof import('firebase/firestore')>()),
  doc: vi.fn(() => ({})),
  onSnapshot: vi.fn((_ref: unknown, ...args: unknown[]) => {
    const options = args.length === 3 ? args[0] : undefined;
    firestore.listener = { next: args[args.length - 2] as SnapshotListener, options };
    return () => undefined;
  }),
}));

import { createOwnerLibrarySessionFirebaseAdapter } from './ownerLibrarySessionFirebaseAdapter';

const subscribe = () => {
  const onDecks = vi.fn();
  createOwnerLibrarySessionFirebaseAdapter({
    app: null,
    database: {} as Firestore,
    configured: true,
  }).subscribeDeckProfile('owner-a', onDecks, vi.fn());
  return onDecks;
};

describe('owner library session firebase adapter', () => {
  beforeEach(() => { firestore.listener = null; });

  it('reports a deck profile the server confirms is absent as an empty profile', () => {
    const onDecks = subscribe();
    firestore.listener?.next({ exists: () => false, data: () => undefined, metadata: { fromCache: false } });
    expect(onDecks).toHaveBeenCalledWith({ decks: [], coverPresets: {} });
  });

  it('does not report a deck profile that is only missing from the device cache', () => {
    const onDecks = subscribe();
    firestore.listener?.next({ exists: () => false, data: () => undefined, metadata: { fromCache: true } });
    expect(onDecks).toHaveBeenCalledWith(null);
  });

  it('listens for metadata changes so a later server answer reaches the session', () => {
    subscribe();
    expect(firestore.listener?.options).toMatchObject({ includeMetadataChanges: true });
  });

  it('passes an existing profile through', () => {
    const onDecks = subscribe();
    firestore.listener?.next({ exists: () => true, data: () => ({ decks: ['IELTS'] }), metadata: { fromCache: true } });
    expect(onDecks).toHaveBeenCalledWith({ decks: ['IELTS'] });
  });
});
