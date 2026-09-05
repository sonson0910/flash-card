import { describe, expect, it } from 'vitest';
import { createSkillEvidenceController } from './skillEvidenceController';
import {
  createLocalSkillEvidenceRecorder,
  createLocalSkillEvidencePersistence,
  readLocalSkillEvidenceLedger,
  skillEvidenceStorageKey,
  type LocalSkillEvidenceInput,
  type SkillEvidenceStorage,
} from './skillEvidenceStorage';

class MemoryStorage implements SkillEvidenceStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null { return this.values.get(key) ?? null; }

  setItem(key: string, value: string): void { this.values.set(key, value); }

  removeItem(key: string): void { this.values.delete(key); }
}

const input = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 4,
  id: 'listen-event-1',
  target: { kind: 'chunk', id: 'break-the-news' },
  skill: 'listening',
  source: 'listening',
  activityId: 'break-the-news',
  score: 1,
  observedAt: '2026-09-05T00:00:00.000Z',
  ...overrides,
});

describe('owner-scoped local skill evidence persistence', () => {
  it('keeps a bounded ledger under an owner-specific local key', async () => {
    const storage = new MemoryStorage();
    const persistence = createLocalSkillEvidencePersistence({
      storage,
      activeOwner: () => 'owner-a',
    });
    const controller = createSkillEvidenceController({ persistence });

    await expect(controller.record(input())).resolves.toMatchObject({ status: 'appended' });
    await expect(controller.record(input())).resolves.toMatchObject({ status: 'appended' });
    expect(skillEvidenceStorageKey('owner-a')).not.toBe(skillEvidenceStorageKey('owner-b'));
    expect(readLocalSkillEvidenceLedger(storage, 'owner-a').records).toHaveLength(1);
    expect(readLocalSkillEvidenceLedger(storage, 'owner-b').records).toHaveLength(0);
  });

  it('fails closed on malformed persisted records and does not cross owners', async () => {
    const storage = new MemoryStorage();
    storage.setItem(skillEvidenceStorageKey('owner-a'), '{malformed');
    const persistence = createLocalSkillEvidencePersistence({
      storage,
      activeOwner: () => 'owner-b',
    });

    expect(readLocalSkillEvidenceLedger(storage, 'owner-a')).toEqual({
      schemaVersion: 4,
      ownerId: 'owner-a',
      records: [],
    });
    await expect(createSkillEvidenceController({ persistence }).record(input()))
      .resolves.toMatchObject({ status: 'appended' });
    expect(readLocalSkillEvidenceLedger(storage, 'owner-a').records).toHaveLength(0);
    expect(readLocalSkillEvidenceLedger(storage, 'owner-b').records).toHaveLength(1);
  });

  it('drops a valid JSON ledger with malformed records instead of crashing Today', () => {
    const storage = new MemoryStorage();
    storage.setItem(skillEvidenceStorageKey('owner-a'), '{"schemaVersion":4,"ownerId":"owner-a","records":[null]}');

    expect(readLocalSkillEvidenceLedger(storage, 'owner-a')).toEqual({
      schemaVersion: 4,
      ownerId: 'owner-a',
      records: [],
    });
  });

  it('rejects a ledger carrying a different owner instead of exposing its records', () => {
    const storage = new MemoryStorage();
    storage.setItem(skillEvidenceStorageKey('owner-a'), '{"schemaVersion":4,"ownerId":"owner-b","records":[]}');

    expect(readLocalSkillEvidenceLedger(storage, 'owner-a')).toEqual({
      schemaVersion: 4,
      ownerId: 'owner-a',
      records: [],
    });
  });

  it('does not accept a conflicting payload under an existing evidence ID', () => {
    const storage = new MemoryStorage();
    const record = createLocalSkillEvidenceRecorder({
      storage,
      activeOwner: () => 'owner-a',
    });

    record(input() as LocalSkillEvidenceInput);
    record(input({ score: 0 }) as LocalSkillEvidenceInput);

    expect(readLocalSkillEvidenceLedger(storage, 'owner-a').records).toEqual([
      { ...input(), ownerId: 'owner-a' },
    ]);
  });

  it('reloads prior recorder evidence before appending a new record', () => {
    const storage = new MemoryStorage();
    const options = { storage, activeOwner: () => 'owner-a' };
    createLocalSkillEvidenceRecorder(options)(input() as LocalSkillEvidenceInput);
    createLocalSkillEvidenceRecorder(options)(input({ id: 'listen-event-2' }) as LocalSkillEvidenceInput);

    expect(readLocalSkillEvidenceLedger(storage, 'owner-a').records.map(record => record.id)).toEqual([
      'listen-event-1', 'listen-event-2',
    ]);
  });

  it('fails closed for malformed incoming listening evidence', () => {
    const storage = new MemoryStorage();
    const record = createLocalSkillEvidenceRecorder({ storage, activeOwner: () => 'owner-a' });
    const malformed = [
      { score: -0.1 },
      { score: 1.1 },
      { score: Number.NaN },
      { id: ' listen-event-2' },
      { activityId: 'activity/2' },
      { observedAt: '2026-09-05' },
      { target: { kind: 'lexeme', id: 'chunk-2' } },
      { target: { kind: 'chunk', id: ' chunk-2' } },
    ];

    malformed.forEach(overrides => record(input(overrides) as LocalSkillEvidenceInput));

    expect(readLocalSkillEvidenceLedger(storage, 'owner-a').records).toEqual([]);
  });
});
