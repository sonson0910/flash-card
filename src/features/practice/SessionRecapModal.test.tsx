import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('SessionRecapModal touch targets', () => {
  it('keeps its close and action controls at least 44px', () => {
    const source = readFileSync(new URL('./SessionRecapModal.tsx', import.meta.url), 'utf8');

    expect(source).toContain('flex size-11 shrink-0 items-center justify-center rounded-xl');
    expect(source.match(/flex min-h-11 flex-1 items-center justify-center gap-2/g)).toHaveLength(2);
  });
});
