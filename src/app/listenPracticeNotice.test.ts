import { i18n } from '@lingui/core';
import { describe, expect, it } from 'vitest';
import { activateCatalogLocale, loadCatalog, setActiveUiLocale } from '../i18n/loadCatalog';
import { listenPracticeUnavailableMessage } from './AppViewStage';

describe('listen practice unavailable notice', () => {
  it('is worded in the active UI language', async () => {
    setActiveUiLocale('vi');
    await loadCatalog('vi', 'shell');
    activateCatalogLocale('vi');

    const offline = listenPracticeUnavailableMessage('owner-a', true);
    const guest = listenPracticeUnavailableMessage(null, false);

    expect(offline && i18n._(offline)).toBe('Kết nối lại để luyện cụm từ này.');
    expect(guest && i18n._(guest)).toBe('Đăng nhập để luyện cụm từ này.');
    expect(listenPracticeUnavailableMessage('owner-a', false)).toBeNull();
  });
});
