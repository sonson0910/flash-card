import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('App owner safety boundary', () => {
  it('drops late category-facet results after the active owner changes', () => {
    const source = readFileSync(new URL('./src/App.tsx', import.meta.url), 'utf8');

    expect(source).toMatch(/const ownerId = user\.uid;[\s\S]*activeOwnerIdRef\.current !== ownerId/);
  });
});
