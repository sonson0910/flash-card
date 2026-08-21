import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('Flashcard UI contracts', () => {
  it('keeps pronunciation controls left-aligned on mobile and right-aligned from sm upward', () => {
    const source = readFileSync(fileURLToPath(new URL('./Flashcard.tsx', import.meta.url)), 'utf8');

    expect(source).toContain('w-full shrink-0 items-center justify-start gap-2 sm:w-auto sm:justify-end sm:pt-4');
  });

  it('uses high-contrast light-theme colors for card statuses and pronunciation states', () => {
    const source = readFileSync(fileURLToPath(new URL('./Flashcard.tsx', import.meta.url)), 'utf8');

    expect(source).toContain('text-emerald-700 dark:text-emerald-400');
    expect(source).toContain('text-rose-700 dark:text-rose-400');
    expect(source).toContain('text-rose-700 dark:text-rose-300');
  });

  it('keeps pronunciation feedback readable in both themes', () => {
    const source = readFileSync(fileURLToPath(new URL('./flashcard/SpeechMatchFeedback.tsx', import.meta.url)), 'utf8');

    expect(source).toContain('border-slate-200 bg-slate-50');
    expect(source).toContain('dark:border-white/15 dark:bg-white/5');
    expect(source).toContain('bg-emerald-50 text-emerald-700');
    expect(source).toContain('bg-amber-50 text-amber-800');
    expect(source).toContain('bg-rose-50 text-rose-700');
    expect(source).toContain('text-cyan-700 dark:text-cyan-300');
  });

  it('renders the AI mnemonic at the bottom of the back face', () => {
    const source = readFileSync(fileURLToPath(new URL('./Flashcard.tsx', import.meta.url)), 'utf8');

    expect(source.indexOf('Ask AI Tutor')).toBeGreaterThan(source.indexOf('Description Translation'));
    expect(source.lastIndexOf('<CardMnemonicSection')).toBeGreaterThan(source.indexOf('Ask AI Tutor'));
  });

  it('removes the lightning glyph from the mnemonic action label', () => {
    const source = readFileSync(fileURLToPath(new URL('./flashcard/CardMnemonicSection.tsx', import.meta.url)), 'utf8');

    expect(source).not.toContain('⚡ Generate AI Mnemonic');
    expect(source).not.toContain('<Sparkles size={14} />');
    expect(source).toContain('Generate AI Mnemonic');
  });
});
