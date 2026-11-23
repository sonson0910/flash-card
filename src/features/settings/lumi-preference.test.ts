import { describe, expect, it, vi } from 'vitest';
import { applyLumiEnabled, LUMI_ENABLED_STORAGE_KEY, readLumiEnabled } from './lumi-preference';

describe('Lumi preference', () => {
  it('persists the setting and mirrors it on the document root', () => {
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn() };
    const root = { dataset: {} as DOMStringMap };
    applyLumiEnabled(false, storage, root);
    expect(storage.setItem).toHaveBeenCalledWith(LUMI_ENABLED_STORAGE_KEY, 'false');
    expect(root.dataset.lumi).toBe('off');
  });

  it('keeps Lumi enabled unless a saved false value says otherwise', () => {
    expect(readLumiEnabled({ getItem: () => null })).toBe(true);
    expect(readLumiEnabled({ getItem: () => 'false' })).toBe(false);
  });
});
