import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { i18n } from '@lingui/core';
import { getLegacyUpgradePresentation } from './LibraryCardGrid';

beforeEach(() => {
  i18n.load('en', {
    'library.upgrade.paused-title': 'Library upgrade paused',
    'library.upgrade.help-title': 'Library upgrade needs administrator help',
    'library.upgrade.upgrading': 'Upgrading…',
    'library.upgrade.retry': 'Retry upgrade',
    'library.upgrade.pending-title': '{count, plural, one {# older card needs} other {# older cards need}} a one-time library upgrade',
    'library.upgrade.pending-description': 'Securely upgrades the library in resumable batches while preserving study progress.',
    'library.upgrade.start': 'Upgrade library',
    'library.upgrade.trusted-migration-description': 'Some older cards need a secure one-time migration. Your cards are safe; an administrator must complete this repair.',
    'library.upgrade.sign-in-description': 'Sign in again, then retry the library upgrade. Your cards remain safe.',
    'library.upgrade.cloud-access-description': 'Cloud access for this library upgrade needs administrator help. Your cards remain safe.',
    'library.upgrade.temporary-description': 'The library upgrade is temporarily unavailable. Your cards remain safe; check your connection and retry.',
  });
  i18n.activate('en');
});

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

  it('formats the pending card count through the localized ICU message', () => {
    expect(getLegacyUpgradePresentation({
      pending: 1,
      migrating: false,
      issue: null,
    })?.title).toBe('1 older card needs a one-time library upgrade');
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
      message: 'Some older cards need a secure one-time migration. Your cards are safe; an administrator must complete this repair.',
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
      message: 'Sign in again, then retry the library upgrade. Your cards remain safe.',
      actionLabel: 'Retry upgrade',
    });
  });

  it('does not render an English controller diagnostic in Vietnamese', () => {
    i18n.load('vi', {
      'library.upgrade.paused-title': 'Nâng cấp thư viện đang tạm dừng',
      'library.upgrade.retry': 'Thử lại nâng cấp',
      'library.upgrade.sign-in-description': 'Hãy đăng nhập lại, rồi thử nâng cấp thư viện. Thẻ của bạn vẫn an toàn.',
    });
    i18n.activate('vi');

    const presentation = getLegacyUpgradePresentation({
      pending: 1,
      migrating: false,
      issue: { kind: 'cloud-access', retryable: true, message: 'Sign in again to continue this library upgrade.' },
    });

    expect(presentation).toMatchObject({
      title: 'Nâng cấp thư viện đang tạm dừng',
      message: 'Hãy đăng nhập lại, rồi thử nâng cấp thư viện. Thẻ của bạn vẫn an toàn.',
      actionLabel: 'Thử lại nâng cấp',
    });
  });
});

describe('library collection hierarchy', () => {
  it('keeps utility chrome flatter than the card collection', () => {
    const source = readFileSync(fileURLToPath(new URL('./LibraryCardGrid.tsx', import.meta.url)), 'utf8');

    expect(source).toContain('data-library-card-collection="true"');
    expect(source).toContain('library.grid.loading-page');
    expect(source).toContain('library.grid.import-progress');
    expect(source).toContain('formatNumber(currentPage)');
    expect(source).not.toMatch(/liquid-glass lg:hidden/);
    expect(source).not.toMatch(/liquid-glass mx-auto mt-10/);
  });
});
