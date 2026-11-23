import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import type { StarterCardOutcome } from './createStarterCards';
import { ProtectedFunctionError } from '../../lib/protectedFunctionsCapability';
import { createStarterTrialGate, starterClaimStore } from './starterTrialGate';

const written: StarterCardOutcome = { created: [{ id: 'card-1' } as CardData], skippedForQuota: 0 };
const refused: StarterCardOutcome = { created: [], skippedForQuota: 5 };

const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
};

describe('starter trial gate', () => {
  it('writes starter cards for one target only, even when the learner changes the target afterwards', async () => {
    const gate = createStarterTrialGate();
    const create = vi.fn(async () => written);

    await expect(gate.run('ko', create)).resolves.toBe(written);
    await expect(gate.run('ja', create)).resolves.toBe('already-added');

    expect(create).toHaveBeenCalledTimes(1);
  });

  it('lets the same target run again, because the same operation replays without spending quota', async () => {
    const gate = createStarterTrialGate();
    const create = vi.fn(async () => written);

    await gate.run('ko', create);
    await gate.run('ja', create);
    await expect(gate.run('ko', create)).resolves.toBe(written);

    expect(create).toHaveBeenCalledTimes(2);
  });

  it('holds another target until the first batch settles and blocks it when cards were written', async () => {
    const gate = createStarterTrialGate();
    let finish!: (outcome: StarterCardOutcome) => void;
    const create = vi.fn(() => new Promise<StarterCardOutcome>(resolve => { finish = resolve; }));

    const first = gate.run('ko', create);
    const second = gate.run('ja', create);
    finish(written);

    await expect(first).resolves.toBe(written);
    await expect(second).resolves.toBe('already-added');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('lets another target write after the first batch settled with nothing written', async () => {
    const gate = createStarterTrialGate();
    let finish!: (outcome: StarterCardOutcome) => void;
    const pending = vi.fn(() => new Promise<StarterCardOutcome>(resolve => { finish = resolve; }));
    const second = vi.fn(async () => written);

    const first = gate.run('ko', pending);
    const other = gate.run('ja', second);
    finish(refused);

    await expect(first).resolves.toBe(refused);
    await expect(other).resolves.toBe(written);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('shares the in-flight batch when the same target is asked again', async () => {
    const gate = createStarterTrialGate();
    let finish!: (outcome: StarterCardOutcome) => void;
    const create = vi.fn(() => new Promise<StarterCardOutcome>(resolve => { finish = resolve; }));

    const first = gate.run('ko', create);
    const again = gate.run('ko', create);
    finish(written);

    await expect(Promise.all([first, again])).resolves.toEqual([written, written]);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('allows another target after a refusal that wrote nothing: quota, sign-in or permission', async () => {
    const gate = createStarterTrialGate();
    const refusal = (kind: ProtectedFunctionError['kind']) => new ProtectedFunctionError({
      message: 'refused', kind, code: kind, retryable: false,
    });

    await expect(gate.run('ko', async () => { throw refusal('authentication'); })).rejects.toThrow('refused');
    await expect(gate.run('ja', async () => { throw refusal('permission'); })).rejects.toThrow('refused');
    await expect(gate.run('zh', async () => refused)).resolves.toBe(refused);
    const create = vi.fn(async () => written);
    await expect(gate.run('en', create)).resolves.toBe(written);

    expect(create).toHaveBeenCalledTimes(1);
  });

  it('keeps the claim when a failure does not prove that nothing was written', async () => {
    const lostReply = new ProtectedFunctionError({ message: 'timeout', kind: 'network', code: 'deadline-exceeded', retryable: true });
    const gate = createStarterTrialGate();
    const create = vi.fn(async () => written);

    await expect(gate.run('ko', async () => { throw lostReply; })).rejects.toThrow('timeout');
    await expect(gate.run('ja', create)).resolves.toBe('already-added');
    await expect(gate.run('ko', create)).resolves.toBe(written);

    expect(create).toHaveBeenCalledTimes(1);
  });

  it('keeps the claim across a reload of the same setup', async () => {
    const storage = memoryStorage();
    const create = vi.fn(async () => written);

    await createStarterTrialGate(starterClaimStore('owner-1', storage)).run('ko', create);
    const reloaded = createStarterTrialGate(starterClaimStore('owner-1', storage));
    await expect(reloaded.run('ja', create)).resolves.toBe('already-added');
    await expect(createStarterTrialGate(starterClaimStore('owner-2', storage)).run('ja', create)).resolves.toBe(written);
    await expect(reloaded.run('ko', create)).resolves.toBe(written);

    expect(create).toHaveBeenCalledTimes(3);
  });

  it('does not keep a claim in storage after a batch that wrote nothing', async () => {
    const storage = memoryStorage();

    await createStarterTrialGate(starterClaimStore('owner-1', storage)).run('ko', async () => refused);
    const create = vi.fn(async () => written);
    await expect(createStarterTrialGate(starterClaimStore('owner-1', storage)).run('ja', create)).resolves.toBe(written);
  });
});
