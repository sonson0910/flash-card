import { describe, expect, it, vi } from 'vitest';
import { downloadWeeklyRecapPng, shareWeeklyRecapPng } from './weeklyRecapShare';

const blob = new Blob(['png-bytes'], { type: 'image/png' });

describe('shareWeeklyRecapPng', () => {
  it('prefers the Web Share API when the platform can share files', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);
    const triggerDownload = vi.fn();
    const writeClipboard = vi.fn();

    const outcome = await shareWeeklyRecapPng(blob, 'recap.png', 'caption', { share, canShare, triggerDownload, writeClipboard });

    expect(outcome).toBe('shared');
    expect(share).toHaveBeenCalledTimes(1);
    expect(triggerDownload).not.toHaveBeenCalled();
    expect(writeClipboard).not.toHaveBeenCalled();
  });

  it('reports failure without falling back when the user cancels the native share sheet', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError'));
    const triggerDownload = vi.fn();

    const outcome = await shareWeeklyRecapPng(blob, 'recap.png', 'caption', { share, triggerDownload });

    expect(outcome).toBe('failed');
    expect(triggerDownload).not.toHaveBeenCalled();
  });

  it('falls back to clipboard copy when the platform cannot share files', async () => {
    const canShare = vi.fn().mockReturnValue(false);
    const share = vi.fn();
    const createClipboardItem = vi.fn((item: Blob) => item);
    const writeClipboard = vi.fn().mockResolvedValue(undefined);
    const triggerDownload = vi.fn();

    const outcome = await shareWeeklyRecapPng(blob, 'recap.png', 'caption', {
      share, canShare, createClipboardItem, writeClipboard, triggerDownload,
    });

    expect(outcome).toBe('copied');
    expect(share).not.toHaveBeenCalled();
    expect(triggerDownload).not.toHaveBeenCalled();
  });

  it('falls back to a plain download when share and clipboard are both unavailable', async () => {
    const triggerDownload = vi.fn();

    const outcome = await shareWeeklyRecapPng(blob, 'recap.png', 'caption', { triggerDownload });

    expect(outcome).toBe('downloaded');
    expect(triggerDownload).toHaveBeenCalledWith(blob, 'recap.png');
  });

  it('falls back to download when clipboard copy itself rejects', async () => {
    const createClipboardItem = vi.fn((item: Blob) => item);
    const writeClipboard = vi.fn().mockRejectedValue(new Error('clipboard denied'));
    const triggerDownload = vi.fn();

    const outcome = await shareWeeklyRecapPng(blob, 'recap.png', 'caption', {
      createClipboardItem, writeClipboard, triggerDownload,
    });

    expect(outcome).toBe('downloaded');
    expect(triggerDownload).toHaveBeenCalledTimes(1);
  });
});

describe('downloadWeeklyRecapPng', () => {
  it('always downloads directly, never attempting Web Share or clipboard', async () => {
    const triggerDownload = vi.fn();

    const outcome = await downloadWeeklyRecapPng(blob, 'recap.png', { triggerDownload });

    expect(outcome).toBe('downloaded');
    expect(triggerDownload).toHaveBeenCalledWith(blob, 'recap.png');
  });
});
