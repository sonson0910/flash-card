import { describe, expect, it } from 'vitest';
import {
  SkillEvidenceConflictError,
  SkillEvidenceLedgerOverflowError,
  appendSkillEvidence,
  deriveSkillStateV4,
  parseSkillEvidenceV4,
  type SkillEvidenceSourceV4,
  type SkillEvidenceSkillV4,
  type SkillEvidenceV4,
} from './skillEvidenceModel';

const validEvidence = (
  source: SkillEvidenceSourceV4,
  skill: SkillEvidenceSkillV4,
  overrides: Partial<SkillEvidenceV4> = {},
) => ({
  schemaVersion: 4,
  id: 'evidence-1',
  ownerId: 'owner-1',
  target: { kind: 'lexeme' as const, id: 'lexeme-1' },
  skill,
  source,
  activityId: 'activity-1',
  score: 0.75,
  observedAt: '2026-09-04T00:00:00.000Z',
  ...overrides,
});

const parsed = (
  source: SkillEvidenceSourceV4,
  skill: SkillEvidenceSkillV4,
  overrides: Partial<SkillEvidenceV4> = {},
): SkillEvidenceV4 => parseSkillEvidenceV4(validEvidence(source, skill, overrides));

describe('SkillEvidenceV4 parser', () => {
  it.each([
    ['recognition', 'recognition'],
    ['listening', 'listening'],
    ['context', 'context'],
    ['text-production', 'production'],
    ['browser-speech-match', 'speech-match'],
    ['pronunciation-provider', 'pronunciation'],
  ] as const)('accepts the %s source only for %s skill', (source, skill) => {
    expect(parseSkillEvidenceV4(validEvidence(source, skill))).toMatchObject({ source, skill });
  });

  it('keeps browser transcript matching outside pronunciation and production', () => {
    expect(parseSkillEvidenceV4(validEvidence('browser-speech-match', 'speech-match')))
      .toMatchObject({ skill: 'speech-match', source: 'browser-speech-match' });
    expect(() => parseSkillEvidenceV4(validEvidence('browser-speech-match', 'pronunciation')))
      .toThrow(/source.*skill|speech-match/i);
    expect(() => parseSkillEvidenceV4(validEvidence('browser-speech-match', 'production')))
      .toThrow(/source.*skill|speech-match/i);
  });

  it('rejects unknown fields and unsafe IDs', () => {
    expect(() => parseSkillEvidenceV4({ ...validEvidence('recognition', 'recognition'), unexpected: true }))
      .toThrow(/unknown field/);
    expect(() => parseSkillEvidenceV4({ ...validEvidence('recognition', 'recognition'), rating: 'good' }))
      .toThrow(/unknown field/);
    expect(() => parseSkillEvidenceV4({ ...validEvidence('recognition', 'recognition'), fsrs: {} }))
      .toThrow(/unknown field/);
    expect(() => parseSkillEvidenceV4(validEvidence('recognition', 'recognition', {
      id: 'evidence/1',
    }))).toThrow(/id.*slash|id/i);
    expect(() => parseSkillEvidenceV4(validEvidence('recognition', 'recognition', {
      activityId: 'activity\u0000-1',
    }))).toThrow(/activityId/i);
  });

  it('rejects missing fields, non-canonical timestamps, and out-of-range scores', () => {
    expect(() => parseSkillEvidenceV4({
      ...validEvidence('recognition', 'recognition'),
      observedAt: '2026-09-04T00:00:00Z',
    })).toThrow(/observedAt.*ISO/i);
    expect(() => parseSkillEvidenceV4({
      ...validEvidence('recognition', 'recognition'),
      score: -0.01,
    })).toThrow(/score/i);
    expect(() => parseSkillEvidenceV4({
      ...validEvidence('recognition', 'recognition'),
      score: 1.01,
    })).toThrow(/score/i);
    expect(() => parseSkillEvidenceV4({
      ...validEvidence('recognition', 'recognition'),
      activityId: undefined,
    })).toThrow(/activityId/i);
  });
});

describe('SkillEvidenceV4 ledger and state', () => {
  it('appends new evidence and treats an identical ID as a duplicate', () => {
    const evidence = parsed('recognition', 'recognition');
    const ledger = { schemaVersion: 4 as const, ownerId: 'owner-1', records: [] };
    const first = appendSkillEvidence(ledger, evidence);
    const duplicate = appendSkillEvidence(first.ledger, evidence);

    expect(first).toEqual({ status: 'appended', ledger: { ...ledger, records: [evidence] } });
    expect(duplicate).toEqual({ status: 'duplicate', ledger: first.ledger });
  });

  it('rejects a reused ID whose canonical content differs', () => {
    const first = parsed('recognition', 'recognition');
    const different = parsed('recognition', 'recognition', { score: 0.5 });
    const ledger = appendSkillEvidence(
      { schemaVersion: 4, ownerId: 'owner-1', records: [] },
      first,
    ).ledger;

    expect(() => appendSkillEvidence(ledger, different)).toThrow(SkillEvidenceConflictError);
  });

  it('refuses to exceed the bounded ledger instead of dropping history', () => {
    const records = Array.from({ length: 512 }, (_, index) => parsed(
      'recognition',
      'recognition',
      { id: `evidence-${index + 1}` },
    ));
    const ledger = { schemaVersion: 4 as const, ownerId: 'owner-1', records };

    expect(() => appendSkillEvidence(ledger, parsed('recognition', 'recognition', {
      id: 'evidence-overflow',
    }))).toThrow(SkillEvidenceLedgerOverflowError);
  });

  it('rebuilds independent dimensions without turning speech match into pronunciation', () => {
    const records = [
      parsed('recognition', 'recognition'),
      parsed('listening', 'listening', { id: 'evidence-2', score: 0.25 }),
      parsed('browser-speech-match', 'speech-match', { id: 'evidence-3', score: 1 }),
    ];
    const state = deriveSkillStateV4(records, { kind: 'lexeme', id: 'lexeme-1' }, 'owner-1');

    expect(state.dimensions.recognition.score).toBe(0.75);
    expect(state.dimensions.listening.score).toBe(0.25);
    expect(state.dimensions.speechMatch.score).toBe(1);
    expect(state.dimensions.pronunciation.score).toBeNull();
    expect(state.dimensions.production.score).toBeNull();
  });

  it('uses the latest eight observations in deterministic timestamp/id order', () => {
    const records = Array.from({ length: 9 }, (_, index) => parsed(
      'recognition',
      'recognition',
      {
        id: `evidence-${String(index + 1).padStart(2, '0')}`,
        score: index / 8,
        observedAt: `2026-09-0${Math.floor(index / 3) + 1}T00:00:00.000Z`,
      },
    ));
    const state = deriveSkillStateV4(records, { kind: 'lexeme', id: 'lexeme-1' }, 'owner-1');

    expect(state.dimensions.recognition.observations).toBe(8);
    expect(state.dimensions.recognition.score).toBeCloseTo((1 + 2 + 3 + 4 + 5 + 6 + 7 + 8) / 8 / 8);
    expect(state.dimensions.recognition.confidence).toBe(1);
    expect(state.dimensions.recognition.lastObservedAt).toBe('2026-09-03T00:00:00.000Z');
    expect(state.asOf).toBe('2026-09-03T00:00:00.000Z');
  });

  it('orders canonical timestamps by instant when years use ISO expanded form', () => {
    const current = parsed('recognition', 'recognition', {
      id: 'evidence-current',
      score: 0.25,
      observedAt: '2026-09-04T00:00:00.000Z',
    });
    const expanded = parsed('recognition', 'recognition', {
      id: 'evidence-expanded',
      score: 1,
      observedAt: '+010000-01-01T00:00:00.000Z',
    });

    const state = deriveSkillStateV4(
      [current, expanded],
      { kind: 'lexeme', id: 'lexeme-1' },
      'owner-1',
    );

    expect(state.dimensions.recognition.lastObservedAt).toBe(expanded.observedAt);
    expect(state.asOf).toBe(expanded.observedAt);
  });

  it('ignores evidence for another owner or target while keeping unseen dimensions empty', () => {
    const state = deriveSkillStateV4([
      parsed('recognition', 'recognition', { ownerId: 'other-owner' }),
      parsed('listening', 'listening', {
        id: 'evidence-2',
        target: { kind: 'chunk', id: 'chunk-1' },
      }),
    ], { kind: 'lexeme', id: 'lexeme-1' }, 'owner-1');

    expect(state.asOf).toBeNull();
    expect(state.dimensions.recognition).toEqual({
      score: null, observations: 0, confidence: 0, lastObservedAt: null,
    });
    expect(state.dimensions.listening).toEqual({
      score: null, observations: 0, confidence: 0, lastObservedAt: null,
    });
  });
});
