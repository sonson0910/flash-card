import { describe, expect, it } from 'vitest';
import type { CardData } from '../../types/card';
import { buildPlacementCheck, evaluatePlacement } from './placementEngine';

const card = (id: string, cefrLevel?: string): CardData => ({
  id,
  word: id,
  normalizedWord: id,
  translation: `meaning ${id}`,
  explanation: '',
  phonetic: '',
  emoji: '',
  category: 'General',
  audioUrl: null,
  imageUrl: null,
  cefrLevel,
});

describe('placement engine', () => {
  it('accepts only unique A1-C2 evidence, balances tiers and caps the check at twelve', () => {
    const cards = [
      ...Array.from({ length: 6 }, (_, index) => card(`f-${index}`, index % 2 ? 'A1' : 'A2')),
      ...Array.from({ length: 6 }, (_, index) => card(`c-${index}`, index % 2 ? 'B1' : 'B2')),
      ...Array.from({ length: 6 }, (_, index) => card(`a-${index}`, index % 2 ? 'C1' : 'C2')),
      card('invalid', 'N5'),
      card('duplicate', 'A1'),
      card('duplicate-copy', 'A2'),
    ];
    cards[cards.length - 1].normalizedWord = 'duplicate';

    const check = buildPlacementCheck(cards);
    expect(check.status).toBe('ready');
    if (check.status !== 'ready') throw new Error('Expected ready placement');
    expect(check.items).toHaveLength(12);
    expect(new Set(check.items.map(item => item.card.normalizedWord)).size).toBe(12);
    expect(new Set(check.items.map(item => item.tier))).toEqual(new Set(['foundation', 'core', 'advanced']));
  });

  it('reports insufficient evidence below six eligible unique cards', () => {
    const check = buildPlacementCheck([
      card('one', 'A1'), card('two', 'A2'), card('three', 'B1'),
      card('four', 'C1'), card('five', 'C2'), card('bad', 'unknown'),
    ]);
    expect(check).toEqual({ status: 'insufficient', eligibleCount: 5, requiredCount: 6 });
  });

  it('recommends a tier no higher than the evidence and reports confidence', () => {
    const foundationOnly = buildPlacementCheck(Array.from({ length: 6 }, (_, index) => card(`f-${index}`, 'A1')));
    if (foundationOnly.status !== 'ready') throw new Error('Expected ready placement');
    expect(evaluatePlacement(foundationOnly, Object.fromEntries(foundationOnly.items.map(item => [item.card.id, true]))))
      .toMatchObject({ status: 'complete', recommendation: 'foundation', confidence: 'low' });

    const mixed = buildPlacementCheck([
      ...Array.from({ length: 4 }, (_, index) => card(`f-${index}`, 'A2')),
      ...Array.from({ length: 4 }, (_, index) => card(`c-${index}`, 'B2')),
      ...Array.from({ length: 4 }, (_, index) => card(`a-${index}`, 'C2')),
    ]);
    if (mixed.status !== 'ready') throw new Error('Expected ready placement');
    expect(evaluatePlacement(mixed, Object.fromEntries(mixed.items.map(item => [item.card.id, true]))))
      .toMatchObject({ status: 'complete', recommendation: 'advanced', confidence: 'high' });
  });

  it('requires at least six answered items and never mutates source cards', () => {
    const cards = Array.from({ length: 6 }, (_, index) => card(`item-${index}`, 'B1'));
    const before = structuredClone(cards);
    const check = buildPlacementCheck(cards);
    if (check.status !== 'ready') throw new Error('Expected ready placement');
    expect(evaluatePlacement(check, { 'item-0': true })).toEqual({
      status: 'insufficient', answeredCount: 1, requiredCount: 6,
    });
    expect(cards).toEqual(before);
  });
});
