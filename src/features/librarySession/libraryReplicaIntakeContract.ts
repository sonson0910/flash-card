import type { CardData } from '../../types/card';

export type LibraryReplicaIntakeSettlementStatus =
  | 'created'
  | 'existing'
  | 'deleted'
  | 'stale';

/**
 * A create request expressed in library-domain terms. Persistence metadata is
 * resolved by the owner-scoped replica rather than supplied by Card Intake.
 */
export interface LibraryReplicaCreateIntent {
  readonly card: CardData;
  readonly libraryEpoch: number;
  readonly knownLibraryTotal?: number;
}

/**
 * The local result of staging a create. `operationId` is an opaque correlation
 * handle used only to match a later settlement with the replica's queue entry.
 */
export interface LibraryReplicaCreateReceipt {
  readonly status: 'queued' | 'stale';
  readonly card: CardData;
  readonly libraryEpoch: number;
  /** Opaque to callers; the replica owns the durable operation identity. */
  readonly operationId: string | null;
}

/** Result of the replica's optional authoritative create attempt. */
export interface LibraryReplicaIntakeResolution {
  readonly status: 'created' | 'existing' | 'queued' | 'stale';
  readonly card: CardData;
  readonly created: boolean;
  readonly queued: boolean;
  readonly receipt: LibraryReplicaCreateReceipt;
  readonly acknowledged: boolean;
}

/** A cloud settlement reported back to the replica after a staged create. */
export interface LibraryReplicaSettlementIntent {
  readonly receipt: LibraryReplicaCreateReceipt;
  readonly outcome: {
    readonly status: LibraryReplicaIntakeSettlementStatus;
    readonly card: CardData;
    readonly libraryEpoch: number;
    readonly revision: number;
  };
}

/**
 * Convergence result. Acknowledgement is deliberately reported only after the
 * replica has completed the local mirror/device work for this operation.
 */
export interface LibraryReplicaSettlementReceipt {
  readonly status: LibraryReplicaIntakeSettlementStatus;
  readonly card: CardData;
  readonly libraryEpoch: number;
  readonly revision: number;
  /** True only after local mirror cleanup and durable acknowledgement succeed. */
  readonly acknowledged: boolean;
}

/** Existing-card convergence input; no new queue operation is created. */
export interface LibraryReplicaExistingSettlementIntent {
  readonly card: CardData;
  readonly knownLibraryTotal?: number;
}

/**
 * Transitional intent-level seam for Card Intake. Implementations may use
 * cloud, mirror and device adapters internally, but none are part of this API.
 */
export interface LibraryReplicaIntakePort {
  findExisting(words: readonly string[]): Promise<Map<string, CardData>>;
  createIntake(input: LibraryReplicaCreateIntent): Promise<LibraryReplicaCreateReceipt>;
  createIntakeBatch(inputs: readonly LibraryReplicaCreateIntent[]): Promise<LibraryReplicaCreateReceipt[]>;
  resolveIntake(receipt: LibraryReplicaCreateReceipt): Promise<LibraryReplicaIntakeResolution>;
  settleIntake(input: LibraryReplicaSettlementIntent): Promise<LibraryReplicaSettlementReceipt>;
  settleExisting(input: LibraryReplicaExistingSettlementIntent): Promise<void>;
}
