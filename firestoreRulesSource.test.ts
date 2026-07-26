import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Firestore rules source invariants', () => {
  it('validates shared-card media at every supported deck position', () => {
    const rules = readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8');
    const checkedIndexes = [...rules.matchAll(/isValidSharedCardMediaAt\(cards, (\d+)\)/g)]
      .map(match => Number(match[1]))
      .sort((left, right) => left - right);
    const aggregateBody = rules.match(
      /function areSharedCardMediaValid\(cards\) \{([\s\S]*?)\n\s*\}/,
    )?.[1] ?? '';
    const aggregateGroups = [...aggregateBody.matchAll(/isValidSharedCardMedia(\d)\(cards\)/g)]
      .map(match => Number(match[1]));

    expect(checkedIndexes).toEqual(Array.from({ length: 100 }, (_, index) => index));
    expect(aggregateGroups).toEqual(Array.from({ length: 10 }, (_, index) => index));
    expect(rules).toMatch(/request\.resource\.data\.cards\.size\(\) <= 100/);
    expect(rules).toMatch(/&& areSharedCardMediaValid\(request\.resource\.data\.cards\)/);
  });
});
