import { checkSelection, contentTypeOf, kindOfSelection, type ClientCheck, type FileKind, type FileLimits, type FileListing, type FilePurpose, type FileSummary } from './fileModel';
import { FileError, toFileError, type FilePort, type UploadTransfer } from './filePort';
import { renameForType, resizeImageForUpload, type ResizedImage } from './imageResize';

/** The chosen file as it will be sent: images are already resized and re-encoded. */
export interface UploadSelection {
  readonly name: string;
  readonly kind: FileKind;
  readonly contentType: string;
  readonly bytes: number;
  readonly data: Blob;
}

export type UploadState =
  | { readonly phase: 'select'; readonly kind: FileKind | null }
  | { readonly phase: 'validating'; readonly check: ClientCheck; readonly name: string; readonly kind: FileKind | null }
  | { readonly phase: 'rejected'; readonly check: ClientCheck; readonly name: string; readonly kind: FileKind | null }
  | { readonly phase: 'uploading' | 'canceled' | 'retry' | 'upload-incomplete'; readonly selection: UploadSelection; readonly sent: number }
  | { readonly phase: 'upload-rejected'; readonly selection: UploadSelection; readonly reason: FileError['kind'] | 'signature' | 'type' | 'size' | 'expired' }
  | { readonly phase: 'quota-exceeded'; readonly selection: UploadSelection }
  | { readonly phase: 'processing'; readonly selection: UploadSelection; readonly fileId: string }
  | { readonly phase: 'results' | 'partial'; readonly selection: UploadSelection; readonly file: FileSummary };

export type UploadPhase = UploadState['phase'];

/**
 * How a step changed the learner's files: a listing just read from the service, or an edit to
 * apply to the listing the host shows, made from what the service answered.
 */
export type FileChange = FileListing | ((listing: FileListing) => FileListing);

export interface UploadSessionOptions {
  readonly port: FilePort;
  /** The plan limits last reported by the service, or null while they are unknown. */
  readonly limits: () => FileLimits | null;
  readonly purpose?: FilePurpose;
  readonly courseId?: () => string | null;
  readonly resize?: (file: Blob) => Promise<ResizedImage>;
  /** How long to wait before each check that the service has settled a finished upload. */
  readonly pollIntervalMs?: number;
  readonly pollAttempts?: number;
  readonly wait?: (milliseconds: number) => Promise<void>;
  /**
   * Told whenever stored files or usage changed, with the change itself, so the host can show it
   * without listing the files again.
   */
  readonly onChanged?: (change: FileChange) => void;
}

export interface UploadSession {
  getState(): UploadState;
  subscribe(listener: () => void): () => void;
  /** Highlights a source kind on the select screen without choosing a file. */
  pickKind(kind: FileKind): void;
  choose(file: File | (Blob & { name: string })): Promise<void>;
  /** Sends a selection whose plan check could not run on the device; the service decides. */
  continueToService(): Promise<void>;
  cancel(): void;
  retry(): Promise<void>;
  attach(courseId: string | null): Promise<FileSummary>;
  reset(): void;
  dispose(): void;
}

const defaultWait = (milliseconds: number) => new Promise<void>(resolve => { setTimeout(resolve, milliseconds); });

export const createUploadSession = (options: UploadSessionOptions): UploadSession => {
  const { port } = options;
  const resize = options.resize ?? resizeImageForUpload;
  const wait = options.wait ?? defaultWait;
  const pollIntervalMs = options.pollIntervalMs ?? 1_500;
  const pollAttempts = options.pollAttempts ?? 20;
  const listeners = new Set<() => void>();
  let state: UploadState = { phase: 'select', kind: null };
  let attempt = 0;
  let transfer: UploadTransfer | null = null;
  let reservedFileId: string | null = null;
  let pending: { selection: UploadSelection } | null = null;
  let unconfirmedFileId: string | null = null;
  let disposed = false;

  const set = (next: UploadState) => {
    if (disposed) return;
    state = next;
    for (const listener of listeners) listener();
  };
  const current = (token: number) => token === attempt && !disposed;

  const releaseReservation = () => {
    const fileId = reservedFileId;
    reservedFileId = null;
    if (!fileId) return;
    void port.remove(fileId).then(
      usage => options.onChanged?.(listing => ({ ...listing, usage, files: listing.files.filter(file => file.id !== fileId) })),
      () => undefined,
    );
  };

  /** What the learner sees once the service has settled an upload: the file, or why it refused it. */
  const settledState = (selection: UploadSelection, file: FileSummary): UploadState => (
    file.status === 'rejected'
      ? file.rejectionReason === 'quota'
        ? { phase: 'quota-exceeded', selection }
        : { phase: 'upload-rejected', selection, reason: file.rejectionReason ?? 'rejected' }
      : { phase: file.status === 'partial' ? 'partial' : 'results', selection, file }
  );

  const confirm = async (token: number, selection: UploadSelection, fileId: string) => {
    for (let index = 0; index < pollAttempts; index += 1) {
      // The service settles an upload only after Cloud Storage reports the stored object, which takes
      // a moment, so each check waits first; a check straight away would only list the files again.
      await wait(pollIntervalMs);
      if (!current(token)) return;
      let listing: FileListing;
      try {
        listing = await port.list();
      } catch (error) {
        // Every further check would be refused too and spend the same budget; the stored file stays.
        if (toFileError(error).kind === 'rate-limited') break;
        continue;
      }
      if (!current(token)) return;
      const file = listing.files.find(candidate => candidate.id === fileId);
      if (file?.status === 'uploading') continue;
      set(!file
        // The reservation expired before the service saw the object.
        ? { phase: 'upload-incomplete', selection, sent: selection.bytes }
        : settledState(selection, file));
      // The listing that settled the upload is the host's next listing too.
      options.onChanged?.(listing);
      return;
    }
    if (current(token)) set({ phase: 'upload-incomplete', selection, sent: selection.bytes });
  };

  const send = async (selection: UploadSelection) => {
    attempt += 1;
    const token = attempt;
    pending = { selection };
    set({ phase: 'validating', check: 'plan', name: selection.name, kind: selection.kind });
    let prepared;
    try {
      prepared = await port.prepare({
        name: selection.name, contentType: selection.contentType, bytes: selection.bytes,
        purpose: options.purpose ?? 'source', courseId: options.courseId?.() ?? null,
      });
    } catch (error) {
      if (!current(token)) return;
      const failure = toFileError(error);
      if (failure.kind === 'quota') set({ phase: 'quota-exceeded', selection });
      else if (failure.kind === 'size') set({ phase: 'rejected', check: 'size', name: selection.name, kind: selection.kind });
      else if (failure.kind === 'type') set({ phase: 'rejected', check: 'type', name: selection.name, kind: selection.kind });
      else if (failure.kind === 'network' || failure.kind === 'unavailable') set({ phase: 'retry', selection, sent: 0 });
      else set({ phase: 'upload-rejected', selection, reason: failure.kind });
      return;
    }
    if (!current(token)) {
      // The attempt was canceled or replaced while the service reserved space for it.
      void port.remove(prepared.fileId).then(
        usage => options.onChanged?.(listing => ({ ...listing, usage, files: listing.files.filter(file => file.id !== prepared.fileId) })),
        () => undefined,
      );
      return;
    }
    reservedFileId = prepared.fileId;
    // The service now holds the bytes in reserve; the record itself is listed once it settles.
    options.onChanged?.(listing => ({
      ...listing, usage: { ...listing.usage, reservedBytes: listing.usage.reservedBytes + selection.bytes },
    }));
    set({ phase: 'uploading', selection, sent: 0 });
    transfer = port.upload(prepared, selection.data, selection.contentType, sent => {
      if (current(token) && state.phase === 'uploading') set({ phase: 'uploading', selection, sent: Math.min(sent, selection.bytes) });
    });
    try {
      await transfer.done;
    } catch (error) {
      transfer = null;
      if (!current(token)) return;
      const failure = toFileError(error);
      const sent = state.phase === 'uploading' ? state.sent : 0;
      if (failure.kind === 'canceled') {
        set({ phase: 'canceled', selection, sent });
      } else if (failure.kind === 'quota') {
        set({ phase: 'quota-exceeded', selection });
      } else if (failure.kind === 'rejected') {
        set({ phase: 'upload-rejected', selection, reason: 'rejected' });
      } else {
        set({ phase: 'retry', selection, sent });
      }
      releaseReservation();
      return;
    }
    transfer = null;
    // The bytes are stored now; only the service may remove this file from here on.
    reservedFileId = null;
    unconfirmedFileId = prepared.fileId;
    if (!current(token)) return;
    set({ phase: 'processing', selection, fileId: prepared.fileId });
    await confirm(token, selection, prepared.fileId);
  };

  const prepareSelection = async (token: number, file: Blob & { name: string }): Promise<UploadSelection | null> => {
    const kind = kindOfSelection({ name: file.name, type: file.type });
    set({ phase: 'validating', check: 'type', name: file.name, kind });
    const typeCheck = checkSelection({ name: file.name, type: file.type, size: file.size }, options.limits());
    if (!typeCheck.ok && typeCheck.check === 'type') {
      set({ phase: 'rejected', check: 'type', name: file.name, kind });
      return null;
    }
    let selection: UploadSelection;
    if (kind === 'image') {
      try {
        const resized = await resize(file);
        if (!current(token)) return null;
        selection = {
          name: renameForType(file.name, resized.contentType), kind, contentType: resized.contentType,
          bytes: resized.blob.size, data: resized.blob,
        };
      } catch {
        if (current(token)) set({ phase: 'rejected', check: 'type', name: file.name, kind });
        return null;
      }
    } else {
      selection = { name: file.name, kind: kind!, contentType: contentTypeOf(file), bytes: file.size, data: file };
    }
    set({ phase: 'validating', check: 'size', name: selection.name, kind });
    const limits = options.limits();
    const check = checkSelection({ name: selection.name, type: selection.contentType, size: selection.bytes }, limits);
    if (!check.ok && check.check === 'size') {
      set({ phase: 'rejected', check: 'size', name: selection.name, kind });
      return null;
    }
    if (kind === 'image' && limits && selection.bytes > limits.maxFileBytes) {
      set({ phase: 'rejected', check: 'size', name: selection.name, kind });
      return null;
    }
    if (!check.ok && check.check === 'plan') {
      pending = { selection };
      set({ phase: 'rejected', check: 'plan', name: selection.name, kind });
      return null;
    }
    return selection;
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    pickKind(kind) {
      if (state.phase === 'select') set({ phase: 'select', kind });
    },
    async choose(file) {
      transfer?.cancel();
      releaseReservation();
      attempt += 1;
      const token = attempt;
      pending = null;
      const selection = await prepareSelection(token, file);
      if (selection && current(token)) await send(selection);
    },
    async continueToService() {
      if (state.phase !== 'rejected' || state.check !== 'plan' || !pending) return;
      await send(pending.selection);
    },
    cancel() {
      if (state.phase === 'uploading') {
        if (transfer) transfer.cancel();
      } else if (state.phase === 'validating') {
        // Whatever is still resizing or reserving space is ignored when it answers; a reservation
        // made in the meantime is given back there.
        attempt += 1;
        set(pending && state.check === 'plan' ? { phase: 'canceled', selection: pending.selection, sent: 0 } : { phase: 'select', kind: null });
      } else if (state.phase === 'processing') {
        attempt += 1;
        // The bytes are stored and counted; a canceled upload must not leave them behind.
        reservedFileId = unconfirmedFileId;
        unconfirmedFileId = null;
        releaseReservation();
        set({ phase: 'canceled', selection: state.selection, sent: state.selection.bytes });
      }
    },
    async retry() {
      if (state.phase !== 'canceled' && state.phase !== 'retry' && state.phase !== 'upload-incomplete') return;
      const { selection } = state;
      if (state.phase === 'upload-incomplete' && unconfirmedFileId) {
        // The service may well have stored the file and only the confirmation failed (a refused
        // listing, for one), so look before replacing it; a file that cannot be checked is kept.
        const fileId = unconfirmedFileId;
        const token = attempt;
        let listing: FileListing;
        try {
          listing = await port.list();
        } catch {
          return;
        }
        if (!current(token) || state.phase !== 'upload-incomplete' || unconfirmedFileId !== fileId) return;
        const file = listing.files.find(candidate => candidate.id === fileId);
        if (file && file.status !== 'uploading') {
          unconfirmedFileId = null;
          set(settledState(selection, file));
          options.onChanged?.(listing);
          return;
        }
        // A new attempt replaces the unconfirmed one, so it cannot be stored twice.
        reservedFileId = fileId;
        releaseReservation();
      }
      unconfirmedFileId = null;
      await send(selection);
    },
    async attach(courseId) {
      if (state.phase !== 'results' && state.phase !== 'partial') throw new FileError('not-found');
      const file = await port.attach(state.file.id, courseId);
      if (state.phase === 'results' || state.phase === 'partial') set({ ...state, file });
      options.onChanged?.(listing => ({ ...listing, files: listing.files.map(stored => (stored.id === file.id ? file : stored)) }));
      return file;
    },
    reset() {
      transfer?.cancel();
      if (state.phase === 'uploading') releaseReservation();
      attempt += 1;
      pending = null;
      set({ phase: 'select', kind: null });
    },
    dispose() {
      transfer?.cancel();
      disposed = true;
      listeners.clear();
    },
  };
};
