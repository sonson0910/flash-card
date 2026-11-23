import { useCallback, useEffect, useRef, useState } from 'react';
import type { FileListing } from './fileModel';
import { FileError, toFileError, type FilePort } from './filePort';
import { createUploadSession, type FileChange } from './uploadSession';

export type FileLibraryState =
  | { readonly status: 'loading'; readonly listing: FileListing | null }
  | { readonly status: 'ready'; readonly listing: FileListing }
  | { readonly status: 'error'; readonly listing: FileListing | null; readonly error: FileError };

/** A further page of files added behind the ones on screen; usage, limits and the cursor come from the newer page. */
export const appendFilePage = (shown: FileListing, page: FileListing): FileListing => {
  const known = new Set(shown.files.map(file => file.id));
  return { ...page, files: [...shown.files, ...page.files.filter(file => !known.has(file.id))] };
};

/** The learner's stored files with usage and plan limits, as the service reports them. */
export const useFileLibrary = (port: FilePort | null) => {
  const [state, setState] = useState<FileLibraryState>({ status: 'loading', listing: null });
  const request = useRef(0);
  // The listing on screen, kept in step with every update so a change applied right after
  // another one builds on it.
  const shownListing = useRef<FileListing | null>(null);

  const show = useCallback((listing: FileListing) => {
    shownListing.current = listing;
    setState({ status: 'ready', listing });
  }, []);

  const refresh = useCallback(async () => {
    if (!port) return;
    request.current += 1;
    const token = request.current;
    setState(previous => ({ status: 'loading', listing: previous.listing }));
    try {
      const listing = await port.list();
      if (token === request.current) show(listing);
    } catch (error) {
      if (token === request.current) setState(previous => ({ status: 'error', listing: previous.listing, error: toFileError(error) }));
    }
  }, [port, show]);

  useEffect(() => { void refresh(); }, [refresh]);

  // The service lists files a page at a time; this adds the next page behind the files on screen.
  const loadMore = useCallback(async () => {
    const shown = shownListing.current;
    if (!port || !shown?.nextCursor) return;
    request.current += 1;
    const token = request.current;
    setState(previous => ({ status: 'loading', listing: previous.listing }));
    try {
      const page = await port.list(shown.nextCursor);
      if (token === request.current) show(appendFilePage(shownListing.current ?? shown, page));
    } catch (error) {
      if (token === request.current) setState(previous => ({ status: 'error', listing: previous.listing, error: toFileError(error) }));
    }
  }, [port, show]);

  /**
   * Shows a change the service already reported: a listing it just returned, or an edit to the one
   * on screen. Only an edit with nothing on screen to edit lists the files again.
   */
  const apply = useCallback((change: FileChange) => {
    if (typeof change !== 'function') {
      request.current += 1;
      show(change);
      return;
    }
    const listing = shownListing.current;
    if (!listing) {
      void refresh();
      return;
    }
    request.current += 1;
    show(change(listing));
  }, [refresh, show]);

  // The service answers a delete with the account's new usage, so the shelf drops the file
  // without listing again.
  const remove = useCallback(async (fileId: string) => {
    if (!port) throw new FileError('unavailable');
    const usage = await port.remove(fileId);
    apply(listing => ({ ...listing, usage, files: listing.files.filter(file => file.id !== fileId) }));
  }, [port, apply]);

  return { state, refresh, loadMore, apply, remove };
};

/** What the card editor needs to put an uploaded photo on a card. */
export interface CardImageUploadTask {
  readonly done: Promise<string>;
  cancel(): void;
}

/**
 * Uploads one card photo: resized to WebP in the browser, settled by the service, then handed
 * back as its download URL. Rejections surface as a `FileError` with the service's reason.
 */
export const startCardImageUpload = (
  port: FilePort,
  file: File,
  onProgress: (fraction: number | null) => void,
): CardImageUploadTask => {
  let limits: FileListing['limits'] | null = null;
  const session = createUploadSession({ port, limits: () => limits, purpose: 'card-image' });
  const done = (async () => {
    try {
      limits = (await port.list()).limits;
    } catch (error) {
      throw toFileError(error);
    }
    const unsubscribe = session.subscribe(() => {
      const state = session.getState();
      if (state.phase === 'uploading') onProgress(state.selection.bytes > 0 ? state.sent / state.selection.bytes : null);
      if (state.phase === 'processing') onProgress(null);
    });
    try {
      await session.choose(file);
    } finally {
      unsubscribe();
    }
    const state = session.getState();
    if (state.phase === 'results' || state.phase === 'partial') return port.downloadUrl(state.file.id);
    if (state.phase === 'quota-exceeded') throw new FileError('quota');
    if (state.phase === 'rejected') throw new FileError(state.check === 'type' ? 'type' : state.check === 'size' ? 'size' : 'unavailable');
    if (state.phase === 'upload-rejected') {
      // The service's own reason survives, so the editor can tell the learner to finish their profile.
      throw new FileError(state.reason === 'signature' || state.reason === 'expired' ? 'rejected' : state.reason);
    }
    if (state.phase === 'canceled') throw new FileError('canceled');
    if (state.phase === 'retry' || state.phase === 'upload-incomplete') throw new FileError('network');
    throw new FileError('rejected');
  })();
  return {
    done,
    cancel: () => {
      session.cancel();
    },
  };
};

/**
 * The card editor's photo uploader (`EditCardDialog`'s `imageUpload` prop). The URL it resolves
 * with is a Cloud Storage download URL, so the card image host lists must accept that host.
 */
export const createCardImageUploader = (port: FilePort) => ({
  upload: (file: File, onProgress: (fraction: number | null) => void) => startCardImageUpload(port, file, onProgress),
});
