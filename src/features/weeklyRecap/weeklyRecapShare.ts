/**
 * Orchestrates what happens with an already-rendered recap PNG: Web Share
 * first (mobile "share to story" style), then clipboard copy, then a plain
 * download link — the one path guaranteed to work everywhere. All browser
 * globals are injectable so this stays testable without a real browser.
 */

export type WeeklyRecapShareOutcome = 'shared' | 'copied' | 'downloaded' | 'failed';

interface ShareCapableNavigator {
  readonly share?: (data: { files: File[]; title?: string; text?: string }) => Promise<void>;
  readonly canShare?: (data: { files: File[] }) => boolean;
  readonly clipboard?: { write?: (items: unknown[]) => Promise<void> };
}

export interface WeeklyRecapShareDeps {
  readonly share?: (data: { files: File[]; title?: string; text?: string }) => Promise<void>;
  readonly canShare?: (data: { files: File[] }) => boolean;
  readonly writeClipboard?: (items: unknown[]) => Promise<void>;
  readonly createClipboardItem?: (blob: Blob) => unknown;
  readonly triggerDownload?: (blob: Blob, filename: string) => void;
}

const defaultTriggerDownload = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

export async function shareWeeklyRecapPng(
  blob: Blob,
  filename: string,
  caption: string,
  deps: WeeklyRecapShareDeps = {},
): Promise<WeeklyRecapShareOutcome> {
  const nav = globalThis.navigator as unknown as ShareCapableNavigator | undefined;
  const share = deps.share ?? nav?.share?.bind(nav);
  const canShare = deps.canShare ?? nav?.canShare?.bind(nav);
  const file = new File([blob], filename, { type: 'image/png' });

  if (share && (!canShare || canShare({ files: [file] }))) {
    try {
      await share({ files: [file], title: 'SonFlash weekly recap', text: caption });
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'failed';
      // Any other rejection (unsupported payload, permission) falls through to clipboard/download.
    }
  }

  const clipboardCtor = (globalThis as { ClipboardItem?: new (items: Record<string, Blob>) => unknown }).ClipboardItem;
  const writeClipboard = deps.writeClipboard ?? nav?.clipboard?.write?.bind(nav.clipboard);
  const createClipboardItem = deps.createClipboardItem
    ?? (clipboardCtor ? (item: Blob) => new clipboardCtor({ [item.type]: item }) : undefined);
  if (writeClipboard && createClipboardItem) {
    try {
      await writeClipboard([createClipboardItem(blob)]);
      return 'copied';
    } catch {
      // Falls through to a plain download.
    }
  }

  const triggerDownload = deps.triggerDownload ?? defaultTriggerDownload;
  triggerDownload(blob, filename);
  return 'downloaded';
}

/** Always a plain download, bypassing Web Share/clipboard — the explicit "Download PNG" action. */
export async function downloadWeeklyRecapPng(
  blob: Blob,
  filename: string,
  deps: Pick<WeeklyRecapShareDeps, 'triggerDownload'> = {},
): Promise<WeeklyRecapShareOutcome> {
  const triggerDownload = deps.triggerDownload ?? defaultTriggerDownload;
  triggerDownload(blob, filename);
  return 'downloaded';
}
