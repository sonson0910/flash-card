import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  SkillEvidenceConflictError,
  createSkillEvidenceController,
  type SkillEvidencePersistencePort,
} from './skillEvidenceController';

const validInput = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 4,
  id: 'evidence-1',
  target: { kind: 'lexeme', id: 'lexeme-1' },
  skill: 'recognition',
  source: 'recognition',
  activityId: 'activity-1',
  score: 0.75,
  observedAt: '2026-09-04T00:00:00.000Z',
  ...overrides,
});

const createFake = (initialOwner: string | null = 'owner-1') => {
  let owner = initialOwner;
  const appended: Array<{ ownerId: string; id: string; score: number }> = [];
  const persistence: SkillEvidencePersistencePort = {
    activeOwner: () => owner,
    append: async evidence => {
      appended.push({ ownerId: evidence.ownerId, id: evidence.id, score: evidence.score });
      return 'appended';
    },
  };
  const controller = createSkillEvidenceController({ persistence });
  return { appended, controller, setOwner: (nextOwner: string | null) => { owner = nextOwner; } };
};

describe('skill evidence controller', () => {
  it('returns no-active-owner without persisting', async () => {
    const { appended, controller } = createFake(null);

    await expect(controller.record(validInput())).resolves.toEqual({ status: 'no-active-owner' });
    expect(appended).toEqual([]);
  });

  it('binds the evidence owner from the active owner and appends once', async () => {
    const { appended, controller } = createFake();

    await expect(controller.record(validInput())).resolves.toMatchObject({
      status: 'appended',
      evidence: { ownerId: 'owner-1', id: 'evidence-1' },
    });
    expect(appended).toEqual([{ ownerId: 'owner-1', id: 'evidence-1', score: 0.75 }]);
  });

  it('rejects a caller-supplied owner field', async () => {
    const { appended, controller } = createFake();

    await expect(controller.record(validInput({ ownerId: 'attacker' })))
      .rejects.toThrow(/ownerId.*caller|owner/i);
    expect(appended).toEqual([]);
  });

  it('replays same-owner duplicates and conflicts on different content', async () => {
    const { appended, controller } = createFake();

    const first = await controller.record(validInput());
    const duplicate = await controller.record(validInput());
    expect(duplicate).toEqual(first);
    expect(appended).toHaveLength(1);

    await expect(controller.record(validInput({ score: 0.25 })))
      .rejects.toBeInstanceOf(SkillEvidenceConflictError);
    expect(appended).toHaveLength(1);
  });

  it('coalesces identical in-flight records and retains only bounded completed outcomes', async () => {
    let release!: () => void;
    let calls = 0;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const persistence: SkillEvidencePersistencePort = {
      activeOwner: () => 'owner-1',
      append: async () => {
        calls += 1;
        await pending;
        return 'duplicate';
      },
    };
    const controller = createSkillEvidenceController({ persistence });
    const first = controller.record(validInput());
    const duplicate = controller.record(validInput());
    release();

    await expect(first).resolves.toMatchObject({ status: 'duplicate' });
    await expect(duplicate).resolves.toMatchObject({ status: 'duplicate' });
    expect(calls).toBe(1);
  });

  it('evicts the oldest completed outcome after the 500-entry bound', async () => {
    const { appended, controller } = createFake();

    for (let index = 0; index < 501; index += 1) {
      await controller.record(validInput({ id: `evidence-${index + 1}` }));
    }
    await controller.record(validInput({ id: 'evidence-1' }));

    expect(appended).toHaveLength(502);
    expect(appended.at(-1)?.id).toBe('evidence-1');
  });

  it('does not publish a pending result after the active owner changes', async () => {
    let owner: string | null = 'owner-1';
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const controller = createSkillEvidenceController({
      persistence: {
        activeOwner: () => owner,
        append: async () => { await pending; return 'appended'; },
      },
    });
    const result = controller.record(validInput());
    owner = 'owner-2';
    release();

    await expect(result).resolves.toEqual({ status: 'stale-owner' });
  });

  it('keeps the controller source vendor-free and exposes no FSRS command', () => {
    const source = readFileSync(fileURLToPath(new URL('./skillEvidenceController.ts', import.meta.url)), 'utf8');

    expect(source).not.toMatch(/firebase|firestore|reviewScheduler|\bfsrs\b|\brating\b/i);
    expect(source).not.toMatch(/from\s+['"]react['"]/);
  });
});
