import { describe, expect, it } from 'vitest';
import { createCatalogPagingGuard } from './catalogPagingGuard';

describe('catalog paging guard', () => {
  it('invalidates old page work as soon as the catalog query changes', () => {
    const guard = createCatalogPagingGuard();
    const oldQuery = guard.capture();

    guard.invalidate();
    const newQuery = guard.capture();

    expect(guard.isCurrent(oldQuery)).toBe(false);
    expect(guard.isCurrent(newQuery)).toBe(true);
  });
});
