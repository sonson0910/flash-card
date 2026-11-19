import type { FirebaseApp } from 'firebase/app';
import type { FirebaseStorage } from 'firebase/storage';
import { app as defaultApp, getSonFlashFunctions } from '../../lib/firebase';
import type { FileListing, FileSummary, FileUsage, PreparedUpload } from './fileModel';
import { FileError, toFileError, type FilePort, type UploadTransfer } from './filePort';

const isE2eEmulatorBuild = import.meta.env.VITE_SONFLASH_E2E_EMULATOR === 'true';
const STORAGE_EMULATOR_HOST = '127.0.0.1';
const STORAGE_EMULATOR_PORT = 9199;

let storagePromise: Promise<FirebaseStorage> | null = null;

/**
 * One Storage client per app, loaded on first use so the SDK stays out of the initial bundle.
 * The emulator build has no bucket in its config, so it names the demo project's default bucket.
 */
const storageFor = (targetApp: FirebaseApp): Promise<FirebaseStorage> => {
  storagePromise ??= import('firebase/storage').then(({ getStorage, connectStorageEmulator }) => {
    const bucket = targetApp.options.storageBucket ? undefined : `gs://${targetApp.options.projectId}.appspot.com`;
    const storage = getStorage(targetApp, bucket);
    if (isE2eEmulatorBuild) connectStorageEmulator(storage, STORAGE_EMULATOR_HOST, STORAGE_EMULATOR_PORT);
    return storage;
  });
  return storagePromise;
};

export interface FirebaseFilePortOptions {
  readonly ownerId: string;
  readonly app?: FirebaseApp | null;
}

/** The real file service: callables for records and usage, Cloud Storage for the bytes. */
export const createFirebaseFilePort = ({ ownerId, app = defaultApp }: FirebaseFilePortOptions): FilePort => {
  const requireApp = (): FirebaseApp => {
    if (!app) throw new FileError('unavailable');
    return app;
  };
  const call = async <T>(name: string, payload: Record<string, unknown>): Promise<T> => {
    try {
      const { httpsCallable } = await import('firebase/functions');
      const callable = httpsCallable<unknown, T>(await getSonFlashFunctions(requireApp()), name);
      return (await callable({ ownerId, ...payload })).data;
    } catch (error) {
      throw toFileError(error);
    }
  };

  return {
    list: () => call<FileListing>('listMyFiles', {}),
    prepare: input => call<PreparedUpload>('prepareFileUpload', { ...input }),
    attach: async (fileId, courseId) => (await call<{ file: FileSummary }>('updateMyFile', { fileId, courseId })).file,
    remove: async fileId => (await call<{ usage: FileUsage }>('deleteMyFile', { fileId })).usage,
    async downloadUrl(fileId) {
      try {
        const { getDownloadURL, ref } = await import('firebase/storage');
        return await getDownloadURL(ref(await storageFor(requireApp()), `users/${ownerId}/files/${fileId}`));
      } catch (error) {
        throw toFileError(error);
      }
    },
    upload(prepared, data, contentType, onProgress): UploadTransfer {
      let cancelled = false;
      let cancelTask: (() => void) | null = null;
      const done = (async () => {
        const { ref, uploadBytesResumable } = await import('firebase/storage');
        const storage = await storageFor(requireApp());
        if (cancelled) throw new FileError('canceled');
        const task = uploadBytesResumable(ref(storage, prepared.path), data, { contentType });
        cancelTask = () => { task.cancel(); };
        await new Promise<void>((resolve, reject) => {
          task.on('state_changed',
            snapshot => onProgress(snapshot.bytesTransferred, snapshot.totalBytes),
            error => reject(toFileError(error)),
            () => resolve());
        });
      })().catch(error => { throw toFileError(error); });
      return {
        done,
        cancel() {
          cancelled = true;
          cancelTask?.();
        },
      };
    },
  };
};
