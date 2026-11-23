import { i18n } from '@lingui/core';
import { afterEach, describe, expect, it } from 'vitest';
import { OperationTimeoutError } from '../../lib/async';
import { CAPTURE_FAILURE_REASONS } from '../../lib/captureFailureMessage';
import { ProtectedFunctionError } from '../../lib/protectedFunctionsCapability';
import { setActiveUiLocale } from '../../i18n/loadCatalog';
import { messages as english } from '../../i18n/locales/en/library.po';
import { messages as vietnamese } from '../../i18n/locales/vi/library.po';
import { CAPTURE_FAILURE_COPY, captureFailureCopy, captureFailureReasonCopy } from './captureFailureCopy';

const activate = (locale: 'en' | 'vi') => {
  i18n.load({ en: english, vi: vietnamese });
  i18n.activate(locale);
};

describe('capture failure copy', () => {
  afterEach(() => {
    setActiveUiLocale('en');
    i18n.activate('en');
  });

  it('has a message for exactly the reasons the extension understands', () => {
    expect(Object.keys(CAPTURE_FAILURE_COPY).sort()).toEqual([...CAPTURE_FAILURE_REASONS].sort());
  });

  it.each(CAPTURE_FAILURE_REASONS)('renders %s in English and in Vietnamese', reason => {
    activate('en');
    const inEnglish = captureFailureReasonCopy(reason);
    activate('vi');
    const inVietnamese = captureFailureReasonCopy(reason);

    expect(inEnglish).toMatch(/^[\x20-\x7e’]+$/);
    expect(inEnglish).not.toContain('library.capture-failure');
    expect(inVietnamese).not.toContain('library.capture-failure');
    expect(inVietnamese).not.toBe(inEnglish);
    expect(inVietnamese).toMatch(/[ăâđêôơưáàảãạéèẻẽẹíìỉĩịóòỏõọúùủũụýỳỷỹỵ]/i);
  });

  it('chooses the message by the reason code of the error and loads its catalog first', async () => {
    const quota = new ProtectedFunctionError({
      message: 'Bạn đã dùng hết số thẻ AI kỳ này.', kind: 'quota', reason: 'ai-card-quota', code: 'resource-exhausted', retryable: false,
    });
    const auth = new ProtectedFunctionError({ message: 'x', kind: 'authentication', code: 'unauthenticated', retryable: false });

    await expect(captureFailureCopy(quota)).resolves.toContain('AI cards');
    await expect(captureFailureCopy(auth)).resolves.toContain('Sign in with Google');
    await expect(captureFailureCopy(new OperationTimeoutError('slow'))).resolves.toContain('took too long');
    await expect(captureFailureCopy(new Error('boom'))).resolves.toContain('could not be created or saved');

    setActiveUiLocale('vi');
    await expect(captureFailureCopy(auth)).resolves.toContain('đăng nhập Google');
  });
});
