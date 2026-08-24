import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import type { CardIntakeControllerPort } from './cardIntakeController';
import { createCardIntakeBindingOwner } from './useCardIntake';

const card = (word: string): CardData => ({
  id: `word-${word}`,
  word,
  normalizedWord: word,
  translation: `${word}-vi`,
  explanation: '',
  phonetic: '',
  emoji: '📝',
  category: 'General',
  audioUrl: null,
  imageUrl: null,
  createdAt: '2026-08-03T00:00:00.000Z',
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
};

const createPort = () => {
  const port: CardIntakeControllerPort = {
    findExisting: vi.fn(async () => new Map()),
    persistStructured: vi.fn(async plan => ({ createdCount: plan.creates.length })),
    touchExisting: vi.fn(async () => undefined),
    generate: vi.fn(async () => ({ created: true, category: 'Imported' })),
    completeFlat: vi.fn(async () => undefined),
    generateCard: vi.fn(async word => ({
      card: card(word),
      mediaPromise: Promise.resolve({ audioUrl: null, imageUrl: null }),
    })),
    persistCards: vi.fn(async (cards: readonly CardData[]) =>
      cards.map((value: CardData) => ({ card: value, created: true }))),
    applyMedia: vi.fn(async () => undefined),
  };
  return port;
};

describe('useCardIntake binding owner', () => {
  it('keeps the public React boundary free of vendor types and React setters', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./useCardIntake.ts', import.meta.url)),
      'utf8',
    );

    expect(source).toMatch(/useSyncExternalStore/);
    expect(source).not.toMatch(/from\s+['"]firebase(?:\/|['"])/);
    expect(source).not.toMatch(/Firestore|QueryDocumentSnapshot|Dispatch|SetStateAction/);
    expect(Object.keys(createCardIntakeBindingOwner({ ports: { cards: createPort() } }).actions)
      .some(key => key.startsWith('set'))).toBe(false);
  });

  it('keeps action identities stable while replacing the active card and draft ports', async () => {
    const first = createPort();
    const second = createPort();
    const firstDraft = { read: vi.fn(() => 'apple'), write: vi.fn(), clear: vi.fn() };
    const secondDraft = { read: vi.fn(() => 'banana'), write: vi.fn(), clear: vi.fn() };
    const owner = createCardIntakeBindingOwner({ ports: { cards: first, draft: firstDraft } });
    const actions = owner.actions;

    await actions.generate();
    expect(first.generateCard).toHaveBeenCalledWith('apple', expect.any(Object));

    owner.replace({ ports: { cards: second, draft: secondDraft } });
    expect(owner.actions).toBe(actions);
    expect(owner.getSnapshot().draft).toBe('banana');
    await actions.generate();
    expect(second.generateCard).toHaveBeenCalledWith('banana', expect.any(Object));
    expect(first.generateCard).toHaveBeenCalledTimes(1);
  });

  it('forwards shared and spreadsheet intents through the current controller', async () => {
    const port = createPort();
    const owner = createCardIntakeBindingOwner({ ports: { cards: port } });

    const shared = await owner.actions.adoptShared({
      cards: [{ word: 'Pear', translation: 'lê' }],
    });
    const spreadsheet = await owner.actions.importSpreadsheet({
      sizeBytes: 10,
      loadWorkbook: async () => null,
    });

    expect(shared).toMatchObject({ status: 'completed', createdCount: 1 });
    expect(spreadsheet).toMatchObject({ status: 'failed', reason: 'read' });
  });

  it('invalidates late media owned by a controller that was replaced mid-generation', async () => {
    const oldPort = createPort();
    const nextPort = createPort();
    const generation = deferred<Awaited<ReturnType<CardIntakeControllerPort['generateCard']>>>();
    const media = deferred<{ audioUrl: string | null; imageUrl: string | null }>();
    vi.mocked(oldPort.generateCard).mockReturnValue(generation.promise);
    const owner = createCardIntakeBindingOwner({ ports: { cards: oldPort } });
    owner.actions.changeDraft('apple');

    const pendingGeneration = owner.actions.generate();
    owner.replace({ ports: { cards: nextPort } });
    generation.resolve({ card: card('apple'), mediaPromise: media.promise });
    const result = await pendingGeneration;
    media.resolve({ audioUrl: 'https://media.example/apple.mp3', imageUrl: null });
    if (result.status === 'created') await result.mediaTask;

    expect(oldPort.applyMedia).not.toHaveBeenCalled();
    expect(nextPort.applyMedia).not.toHaveBeenCalled();
  });

  it('replaces the controller when the owner changes even if its port is stable', async () => {
    const port = createPort();
    const generation = deferred<Awaited<ReturnType<CardIntakeControllerPort['generateCard']>>>();
    vi.mocked(port.generateCard).mockReturnValueOnce(generation.promise);
    const owner = createCardIntakeBindingOwner({ ownerKey: 'owner-a', ports: { cards: port } });
    owner.actions.changeDraft('apple');
    const pending = owner.actions.generate();

    owner.replace({ ownerKey: 'owner-b', ports: { cards: port } });
    generation.resolve({
      card: card('apple'),
      mediaPromise: Promise.resolve({ audioUrl: null, imageUrl: null }),
    });
    await pending;

    expect(owner.getSnapshot()).toMatchObject({ draft: '', isSubmitting: false, error: null });
    expect(port.applyMedia).not.toHaveBeenCalled();
  });

  it('disposes the owned controller and suppresses its pending media task', async () => {
    const port = createPort();
    const media = deferred<{ audioUrl: string | null; imageUrl: string | null }>();
    vi.mocked(port.generateCard).mockResolvedValue({ card: card('apple'), mediaPromise: media.promise });
    const owner = createCardIntakeBindingOwner({ ports: { cards: port } });
    owner.actions.changeDraft('apple');
    const result = await owner.actions.generate();

    owner.dispose();
    media.resolve({ audioUrl: 'https://media.example/apple.mp3', imageUrl: null });
    if (result.status === 'created') await result.mediaTask;

    expect(port.applyMedia).not.toHaveBeenCalled();
  });

  it('returns stale and preserves the replacement owner after a deferred import', async () => {
    const oldPort = createPort();
    const nextPort = createPort();
    const workbook = deferred<{ structuredRows: never[]; flatRows: string[][] }>();
    const oldResetSource = vi.fn();
    const nextResetSource = vi.fn();
    const owner = createCardIntakeBindingOwner({
      ports: { cards: oldPort, resetSpreadsheetSource: oldResetSource },
    });
    const notifications: ReturnType<typeof owner.getSnapshot>[] = [];
    const unsubscribe = owner.subscribe(() => notifications.push(owner.getSnapshot()));
    const pending = owner.actions.importSpreadsheet({
      sizeBytes: 1024,
      loadWorkbook: () => workbook.promise,
    });

    owner.replace({
      ports: { cards: nextPort, resetSpreadsheetSource: nextResetSource },
    });
    const replacementSnapshot = owner.getSnapshot();
    notifications.length = 0;
    workbook.resolve({ structuredRows: [], flatRows: [['apple']] });

    await expect(pending).resolves.toEqual({ status: 'stale' });
    expect(oldPort.findExisting).not.toHaveBeenCalled();
    expect(oldPort.generate).not.toHaveBeenCalled();
    expect(nextPort.findExisting).not.toHaveBeenCalled();
    expect(nextPort.generate).not.toHaveBeenCalled();
    expect(oldResetSource).not.toHaveBeenCalled();
    expect(nextResetSource).not.toHaveBeenCalled();
    expect(owner.getSnapshot()).toEqual(replacementSnapshot);
    expect(notifications).toEqual([]);

    unsubscribe();
  });
});
