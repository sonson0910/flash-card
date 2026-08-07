import type { LexemeV3, TrackMembershipV3 } from '../multilingual/schemaV3';
import type { BuiltCatalogRelease } from './catalogBuilder';
import { fingerprintCatalogEntity, sha256Hex } from './catalogBuilder';
import { decideCatalogVersion } from './catalogVersioning';

export type CatalogEntityKind = 'lexeme' | 'membership';
export type CatalogEntityValue = LexemeV3 | TrackMembershipV3;

export interface ActiveCatalogReleaseIdentity {
  readonly catalogId: string;
  readonly releaseId: string;
  readonly sequence: number;
  readonly manifestFingerprint: string;
}

export interface CurrentCatalogEntity {
  readonly entityKind: CatalogEntityKind;
  readonly entityId: string;
  readonly value: CatalogEntityValue;
  readonly contentVersion: number;
  readonly contentFingerprint: string;
}

export interface CurrentCatalogImportState {
  readonly activeRelease: ActiveCatalogReleaseIdentity | null;
  readonly entities: readonly CurrentCatalogEntity[];
}

export interface CatalogImportOperation {
  readonly action: 'create' | 'update' | 'archive' | 'unchanged';
  readonly entityKind: CatalogEntityKind;
  readonly entityId: string;
  readonly value: CatalogEntityValue;
  readonly contentVersion: number;
  readonly contentFingerprint: string;
}

export type CatalogImportPlanResult =
  | { readonly status: 'unchanged' }
  | {
      readonly status: 'planned';
      readonly mode: 'dry-run';
      readonly expectedActiveRelease: ActiveCatalogReleaseIdentity | null;
      readonly nextActiveRelease: ActiveCatalogReleaseIdentity;
      readonly operations: readonly CatalogImportOperation[];
    }
  | {
      readonly status: 'conflict';
      readonly reason:
        | 'release-cas-conflict'
        | 'release-collision'
        | 'duplicate-current-entity'
        | 'invalid-current-entity'
        | 'duplicate-incoming-entity'
        | 'entity-version-conflict';
      readonly entityKind?: CatalogEntityKind;
      readonly entityId?: string;
      readonly detail?: string;
    };

const keyOf = (kind: CatalogEntityKind, id: string): string => `${kind}:${id}`;

const kindOf = (value: CatalogEntityValue): CatalogEntityKind => (
  'language' in value ? 'lexeme' : 'membership'
);

const fingerprintIdentity = async (value: CatalogEntityValue) => ({
  contentVersion: value.contentVersion,
  contentFingerprint: `sha256:${await fingerprintCatalogEntity(value)}`,
});

const archiveValue = (
  current: CurrentCatalogEntity,
  occurredAt: string,
): CatalogEntityValue => {
  if (current.entityKind === 'lexeme') {
    const value = current.value as LexemeV3;
    return {
      ...value,
      provenance: { ...value.provenance, editorialStatus: 'archived' },
      contentVersion: current.contentVersion + 1,
      updatedAt: occurredAt,
    };
  }
  const value = current.value as TrackMembershipV3;
  return { ...value, editorialStatus: 'archived', contentVersion: current.contentVersion + 1 };
};

const operationOrder = (left: CatalogImportOperation, right: CatalogImportOperation): number => (
  (left.entityKind < right.entityKind ? -1 : left.entityKind > right.entityKind ? 1 : 0)
  || (left.entityId < right.entityId ? -1 : left.entityId > right.entityId ? 1 : 0)
);

export async function planCatalogImport(
  current: CurrentCatalogImportState,
  incoming: BuiltCatalogRelease,
): Promise<CatalogImportPlanResult> {
  const active = current.activeRelease;
  const manifest = incoming.manifest;
  const manifestFingerprint = `sha256:${await sha256Hex(incoming.manifestBytes)}`;
  if (
    active !== null
    && active.catalogId === manifest.catalogId
    && active.releaseId === manifest.releaseId
    && active.sequence === manifest.sequence
  ) {
    return active.manifestFingerprint === manifestFingerprint
      ? { status: 'unchanged' }
      : { status: 'conflict', reason: 'release-collision' };
  }
  const validInitial = active === null
    && manifest.sequence === 1
    && manifest.previousReleaseId === null;
  const validAdvance = active !== null
    && active.catalogId === manifest.catalogId
    && manifest.sequence === active.sequence + 1
    && manifest.previousReleaseId === active.releaseId;
  if (!validInitial && !validAdvance) {
    return { status: 'conflict', reason: 'release-cas-conflict' };
  }

  const currentByKey = new Map<string, CurrentCatalogEntity>();
  for (const item of current.entities) {
    const key = keyOf(item.entityKind, item.entityId);
    if (currentByKey.has(key)) {
      return {
        status: 'conflict', reason: 'duplicate-current-entity',
        entityKind: item.entityKind, entityId: item.entityId,
      };
    }
    if (item.value.id !== item.entityId || kindOf(item.value) !== item.entityKind) {
      return {
        status: 'conflict', reason: 'invalid-current-entity',
        entityKind: item.entityKind, entityId: item.entityId,
      };
    }
    const actual = await fingerprintIdentity(item.value);
    if (
      actual.contentVersion !== item.contentVersion
      || actual.contentFingerprint !== item.contentFingerprint
    ) {
      return {
        status: 'conflict', reason: 'invalid-current-entity',
        entityKind: item.entityKind, entityId: item.entityId,
      };
    }
    currentByKey.set(key, item);
  }

  const incomingByKey = new Map<string, CatalogEntityValue>();
  for (const chunk of incoming.chunks) {
    for (const value of [...chunk.payload.lexemes, ...chunk.payload.memberships]) {
      const kind = kindOf(value);
      const key = keyOf(kind, value.id);
      if (incomingByKey.has(key)) {
        return {
          status: 'conflict', reason: 'duplicate-incoming-entity',
          entityKind: kind, entityId: value.id,
        };
      }
      incomingByKey.set(key, value);
    }
  }

  const operations: CatalogImportOperation[] = [];
  for (const [key, value] of incomingByKey) {
    const kind = kindOf(value);
    const existing = currentByKey.get(key) ?? null;
    const incomingIdentity = await fingerprintIdentity(value);
    const decision = decideCatalogVersion(existing, incomingIdentity);
    if (decision.status === 'conflict') {
      return {
        status: 'conflict', reason: 'entity-version-conflict',
        entityKind: kind, entityId: value.id, detail: decision.reason,
      };
    }
    const action = decision.status === 'advance' ? 'update' : decision.status;
    operations.push({
      action,
      entityKind: kind,
      entityId: value.id,
      value,
      ...incomingIdentity,
    });
    currentByKey.delete(key);
  }

  for (const existing of currentByKey.values()) {
    const alreadyArchived = existing.entityKind === 'lexeme'
      ? (existing.value as LexemeV3).provenance.editorialStatus === 'archived'
      : (existing.value as TrackMembershipV3).editorialStatus === 'archived';
    if (alreadyArchived) {
      operations.push({
        action: 'unchanged',
        entityKind: existing.entityKind,
        entityId: existing.entityId,
        value: existing.value,
        contentVersion: existing.contentVersion,
        contentFingerprint: existing.contentFingerprint,
      });
      continue;
    }
    const value = archiveValue(existing, manifest.createdAt);
    const archivedIdentity = await fingerprintIdentity(value);
    const decision = decideCatalogVersion(existing, archivedIdentity);
    if (decision.status !== 'advance') {
      return {
        status: 'conflict', reason: 'entity-version-conflict',
        entityKind: existing.entityKind, entityId: existing.entityId,
        detail: decision.status === 'conflict' ? decision.reason : decision.status,
      };
    }
    operations.push({
      action: 'archive',
      entityKind: existing.entityKind,
      entityId: existing.entityId,
      value,
      ...archivedIdentity,
    });
  }

  operations.sort(operationOrder);
  return {
    status: 'planned',
    mode: 'dry-run',
    expectedActiveRelease: active,
    nextActiveRelease: {
      catalogId: manifest.catalogId,
      releaseId: manifest.releaseId,
      sequence: manifest.sequence,
      manifestFingerprint,
    },
    operations,
  };
}
