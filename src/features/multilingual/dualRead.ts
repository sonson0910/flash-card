import { normalizeCardData } from '../../lib/cardNormalization';
import type { CardData } from '../../types/card';
import { projectLexemeAggregateV3ToCardData } from './compatibilityProjection';
import { parseLexemeAggregateV3 } from './schemaV3Validation';

export interface DualReadOptions {
  readonly expectedOwnerId?: string;
  readonly trackId?: string;
  readonly requireLearningState?: boolean;
}

export type DualReadResult =
  | { readonly sourceVersion: 'v2'; readonly card: CardData }
  | { readonly sourceVersion: 'v3'; readonly card: CardData };

const recordAt = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('A card document must be an object.');
  }
  return value as Record<string, unknown>;
};

export function readCardDocumentV2V3(
  value: unknown,
  documentId: string,
  options: DualReadOptions = {},
): DualReadResult {
  const record = recordAt(value);
  if (record.schemaVersion === 3) {
    if (record.learningState !== null && options.expectedOwnerId === undefined) {
      throw new TypeError('expectedOwnerId is required for a v3 learning-state read.');
    }
    const aggregate = parseLexemeAggregateV3(record, {
      expectedOwnerId: options.expectedOwnerId,
    });
    return {
      sourceVersion: 'v3',
      card: projectLexemeAggregateV3ToCardData(aggregate, {
        trackId: options.trackId,
        requireLearningState: options.requireLearningState ?? true,
      }),
    };
  }
  if (
    record.schemaVersion !== undefined
    && record.schemaVersion !== 1
    && record.schemaVersion !== 2
  ) {
    throw new TypeError(`Unsupported card schema version: ${String(record.schemaVersion)}.`);
  }
  return {
    sourceVersion: 'v2',
    card: normalizeCardData(record as Partial<CardData>, documentId),
  };
}
