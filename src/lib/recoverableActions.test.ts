import { describe, expect, it, vi } from 'vitest';
import {
  copyTextToClipboard,
  translateExplanationSafely,
} from './recoverableActions';
import { classifyProtectedFunctionError } from './protectedFunctionsCapability';

describe('recoverable async actions', () => {
  it('absorbs clipboard rejection and reports a recoverable failure', async () => {
    const writeText = vi.fn(async () => {
      throw new Error('permission detail must stay internal');
    });

    await expect(copyTextToClipboard({ writeText }, 'https://example.test/share')).resolves.toEqual({
      status: 'failed',
    });
    expect(writeText).toHaveBeenCalledWith('https://example.test/share');
  });

  it('reports success after the clipboard accepts the text', async () => {
    const writeText = vi.fn(async () => undefined);

    await expect(copyTextToClipboard({ writeText }, 'https://example.test/share')).resolves.toEqual({
      status: 'copied',
    });
  });

  it('absorbs explanation translation rejection so the action can be retried', async () => {
    const translate = vi.fn(async () => {
      throw new Error('provider detail must stay internal');
    });

    await expect(translateExplanationSafely(translate, 'A useful explanation.')).resolves.toEqual({
      status: 'failed',
    });
  });

  it('rejects an empty generated translation and returns usable output otherwise', async () => {
    await expect(translateExplanationSafely(async () => '   ', 'A useful explanation.')).resolves.toEqual({
      status: 'failed',
    });
    await expect(translateExplanationSafely(async () => 'Bản dịch hữu ích.', 'A useful explanation.')).resolves.toEqual({
      status: 'translated',
      value: 'Bản dịch hữu ích.',
    });
  });

  it('preserves only a classified protected-service message for translation feedback', async () => {
    const safeFailure = classifyProtectedFunctionError(
      Object.assign(new Error('private backend detail'), { code: 'functions/failed-precondition' }),
      'Translation',
    );

    await expect(translateExplanationSafely(
      async () => { throw safeFailure; },
      'A useful explanation.',
    )).resolves.toEqual({
      status: 'failed',
      message: 'Translation cannot run because this app and its cloud deployment are out of sync. Update the deployment configuration before retrying.',
    });
  });
});
