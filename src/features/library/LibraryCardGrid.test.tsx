import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getLegacyUpgradePresentation, getLibraryHeading } from './LibraryCardGrid';
import { ALL_PRACTICE_DECK_SCOPE } from '../../lib/practiceScope';

describe('legacy library upgrade presentation', () => {
  it('uses product language and offers one secure resumable upgrade action', () => {
    expect(getLegacyUpgradePresentation({
      pending: 12,
      migrating: false,
      issue: null,
    })).toEqual({
      title: '12 older cards need a one-time library upgrade',
      message: 'Securely upgrades the library in resumable batches while preserving study progress.',
      actionLabel: 'Upgrade library',
    });
  });

  it('does not offer a retry when the browser cannot safely repair the batch', () => {
    expect(getLegacyUpgradePresentation({
      pending: 1,
      migrating: false,
      issue: {
        kind: 'trusted-migration',
        retryable: false,
        message: 'Some older cards need a secure one-time migration.',
      },
    })).toEqual({
      title: 'Library upgrade needs administrator help',
      message: 'Some older cards need a secure one-time migration.',
      actionLabel: null,
    });
  });

  it('turns a recoverable cloud failure into an explicit retry', () => {
    expect(getLegacyUpgradePresentation({
      pending: 12,
      migrating: false,
      issue: {
        kind: 'cloud-access',
        retryable: true,
        message: 'Cloud access was rejected.',
      },
    })).toMatchObject({
      title: 'Library upgrade paused',
      message: 'Cloud access was rejected.',
      actionLabel: 'Retry upgrade',
    });
  });
});

describe('library collection hierarchy', () => {
  it('keeps utility chrome flatter than the card collection', () => {
    const source = readFileSync(fileURLToPath(new URL('./LibraryCardGrid.tsx', import.meta.url)), 'utf8');

    expect(source).toContain('data-library-card-collection="true"');
    expect(source).not.toMatch(/liquid-glass lg:hidden/);
    expect(source).not.toMatch(/liquid-glass mx-auto mt-10/);
  });

  it('names the active deck space in the collection heading', () => {
    expect(getLibraryHeading('All', { kind: 'deck', name: 'IELTS' })).toBe('IELTS deck');
    expect(getLibraryHeading('Study', ALL_PRACTICE_DECK_SCOPE)).toBe('Study');
  });
});
