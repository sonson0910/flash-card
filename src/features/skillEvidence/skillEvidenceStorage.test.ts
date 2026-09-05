import { describe, expect, it } from 'vitest';
import { createSkillEvidenceController } from './skillEvidenceController';
import {
  createLocalSkillEvidencePersistence,
  readLocalSkillEvidenceLedger,
  skillEvidenceStorageKey,
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
});
