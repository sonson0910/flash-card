export interface DeviceBackupOwnership {
  ownerUserId: string | null | undefined;
  conflicted: boolean;
}

const hasOwn = (value: object, key: string): boolean => (
  Object.prototype.hasOwnProperty.call(value, key)
);

const addOwnerClaim = (claims: Set<string>, value: unknown): boolean => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) return false;
  claims.add(value);
  return true;
};

export function deviceBackupHasStoredData(value: unknown): boolean {
  if (value === undefined) return false;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return true;
  const backup = value as Record<string, unknown>;
  const collectionHasDataOrIsMalformed = (field: 'cards' | 'items' | 'pending') => {
    if (!hasOwn(backup, field)) return false;
    const collection = backup[field];
    return !Array.isArray(collection) || collection.length > 0;
  };

  return collectionHasDataOrIsMalformed('cards')
    || collectionHasDataOrIsMalformed('items')
    || collectionHasDataOrIsMalformed('pending')
    || (hasOwn(backup, 'total') && backup.total !== 0);
}

export function resolveDeviceBackupOwnership(value: unknown): DeviceBackupOwnership {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ownerUserId: undefined, conflicted: false };
  }

  const backup = value as Record<string, unknown>;
  const claims = new Set<string>();
  let conflicted = false;
  let explicitGuest = false;

  if (hasOwn(backup, 'ownerUserId')) {
    if (backup.ownerUserId === null) explicitGuest = true;
    else if (!addOwnerClaim(claims, backup.ownerUserId)) conflicted = true;
  }

  if (backup.cloudSync !== null && backup.cloudSync !== undefined) {
    if (typeof backup.cloudSync !== 'object' || Array.isArray(backup.cloudSync)) {
      conflicted = true;
    } else {
      const cloudSync = backup.cloudSync as Record<string, unknown>;
      if (!hasOwn(cloudSync, 'userId') || !addOwnerClaim(claims, cloudSync.userId)) {
        conflicted = true;
      }
    }
  }

  if (backup.pending !== undefined && !Array.isArray(backup.pending)) {
    conflicted = true;
  } else if (Array.isArray(backup.pending)) {
    for (const operation of backup.pending) {
      if (!operation || typeof operation !== 'object' || Array.isArray(operation)) continue;
      const pendingOperation = operation as Record<string, unknown>;
      if (hasOwn(pendingOperation, 'ownerUserId') && !addOwnerClaim(claims, pendingOperation.ownerUserId)) {
        conflicted = true;
      }
    }
  }

  if (claims.size > 1 || (explicitGuest && claims.size > 0)) conflicted = true;
  if (conflicted) return { ownerUserId: undefined, conflicted: true };
  if (explicitGuest) return { ownerUserId: null, conflicted: false };
  return { ownerUserId: claims.size === 1 ? [...claims][0] : undefined, conflicted: false };
}
