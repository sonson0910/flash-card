import type { Messages } from '@lingui/core';
import { describe, expect, it } from 'vitest';
import { expandPseudoCatalog } from './pseudo';

describe('pseudo locale expansion', () => {
  it('brackets and stretches display text while preserving ICU arguments and selectors', () => {
    const messages = {
      plain: ['Śţũďŷ'],
      count: ['Ōŵń ', ['count', 'plural', { one: ['# ćàŕď'], other: ['# ćàŕďś'] }], ' ţōďàŷ'],
    } as unknown as Messages;

    const expanded = expandPseudoCatalog(messages) as Record<string, unknown>;
    expect(expanded.plain).toEqual(['[', 'Śţũďŷ··', ']']);
    expect(expanded.count).toEqual([
      '[', 'Ōŵń ··', ['count', 'plural', { one: ['# ćàŕď···'], other: ['# ćàŕďś···'] }], ' ţōďàŷ···', ']',
    ]);
  });
});
