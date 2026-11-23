import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import type { StarterCardOutcome } from './createStarterCards';
import { createStarterTrialGate } from './starterTrialGate';

const written: StarterCardOutcome = { created: [{ id: 'card-1' } as CardData], skippedForQuota: 0 };
const refused: StarterCardOutcome = { created: [], skippedForQuota: 5 };

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

  it('blocks another target while the first batch is still being written', async () => {
    const gate = createStarterTrialGate();
    let finish!: (outcome: StarterCardOutcome) => void;
    const create = vi.fn(() => new Promise<StarterCardOutcome>(resolve => { finish = resolve; }));

    const first = gate.run('ko', create);
    await expect(gate.run('ja', create)).resolves.toBe('already-added');
    finish(written);
    await first;

    expect(create).toHaveBeenCalledTimes(1);
  });

  it('allows another target after a failed or quota-refused batch, because nothing was written', async () => {
    const gate = createStarterTrialGate();

    await expect(gate.run('ko', async () => { throw new Error('offline'); })).rejects.toThrow('offline');
    await expect(gate.run('ja', async () => refused)).resolves.toBe(refused);
    const create = vi.fn(async () => written);
    await expect(gate.run('zh', create)).resolves.toBe(written);

    expect(create).toHaveBeenCalledTimes(1);
  });
});
