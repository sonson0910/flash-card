export interface LibraryOwnerLease {
  readonly ownerId: string | null;
  readonly generation: number;
}

export interface LibrarySessionLifecycle {
  activate: (ownerId: string | null) => LibraryOwnerLease;
  isCurrent: (lease: LibraryOwnerLease) => boolean;
  listen: <T>(
    lease: LibraryOwnerLease,
    subscribe: (emit: (value: T) => void) => () => void,
    publish: (value: T) => void,
  ) => () => void;
}

export function createLibrarySessionLifecycle(): LibrarySessionLifecycle {
  let active: LibraryOwnerLease = { ownerId: null, generation: 0 };

  const isCurrent = (lease: LibraryOwnerLease) =>
    lease.ownerId === active.ownerId && lease.generation === active.generation;

  return {
    activate(ownerId) {
      active = { ownerId, generation: active.generation + 1 };
      return active;
    },
    isCurrent,
    listen(lease, subscribe, publish) {
      let closed = false;
      const unsubscribe = subscribe(value => {
        if (!closed && isCurrent(lease)) publish(value);
      });
      return () => {
        if (closed) return;
        closed = true;
        unsubscribe();
      };
    },
  };
}
