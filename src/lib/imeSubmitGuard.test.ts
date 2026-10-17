import { describe, expect, it, vi } from 'vitest';
import { createImeSubmitGuard } from './imeSubmitGuard';

describe('createImeSubmitGuard', () => {
  it('blocks every submit during composition and only permits a pointer submit after it ends', () => {
    vi.useFakeTimers();
    try {
      const guard = createImeSubmitGuard();
      guard.onCompositionStart();
      expect(guard.shouldBlockKeyDown({ key: 'a', keyCode: 229 })).toBe(false);
      expect(guard.shouldBlockKeyDown({ key: 'Enter', keyCode: 229 })).toBe(true);
      expect(guard.shouldBlockSubmit({ keyCode: 13 })).toBe(true);
      expect(guard.shouldBlockSubmit({}, true)).toBe(true);

      guard.onCompositionEnd();
      expect(guard.shouldBlockSubmit({ keyCode: 13 })).toBe(true);
      expect(guard.shouldBlockSubmit({ keyCode: 13 }, true)).toBe(false);

      vi.runAllTimers();
      expect(guard.shouldBlockSubmit({ isComposing: true, keyCode: 13 })).toBe(true);
      expect(guard.shouldBlockSubmit({ keyCode: 229 }, true)).toBe(true);
      expect(guard.shouldBlockSubmit({ keyCode: 13 })).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
