import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('Flashcard mobile controls', () => {
  it('keeps pronunciation controls left-aligned on mobile and right-aligned from sm upward', () => {
    const source = readFileSync(fileURLToPath(new URL('./Flashcard.tsx', import.meta.url)), 'utf8');

    expect(source).toContain('w-full shrink-0 items-center justify-start gap-2 sm:w-auto sm:justify-end sm:pt-4');
  });
});
