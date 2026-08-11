import { describe, expect, it } from 'vitest';
import { getLegacyUpgradePresentation } from './LibraryCardGrid';

describe('legacy library upgrade presentation', () => {
  it('uses product language and offers a bounded upgrade action', () => {
    expect(getLegacyUpgradePresentation({
      pending: 12,
      migrating: false,
      issue: null,
    })).toEqual({
      title: '12 older cards need a one-time library upgrade',
      message: 'Upgrade up to 100 cards at a time without loading your entire library.',
      actionLabel: 'Upgrade next 100',
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
