import type { CardImageUploader } from '../features/cardEdit/EditCardDialog';
import type { FilePort } from '../features/files/filePort';

/**
 * The card editor's photo uploader for a signed-in learner. The upload flow (resize, transfer,
 * the service's verdict) loads when the learner first picks a photo, not with the app runtime.
 */
export const createDeferredCardImageUploader = (port: FilePort): CardImageUploader => ({
  upload(file, onProgress) {
    let canceled = false;
    let started: { cancel(): void } | null = null;
    const done = Promise.all([
      import('../features/files/fileLibrary'),
      import('../features/files/filePort'),
    ]).then(([{ startCardImageUpload }, { FileError }]) => {
      if (canceled) throw new FileError('canceled');
      const task = startCardImageUpload(port, file, onProgress);
      started = task;
      return task.done;
    });
    return {
      done,
      cancel: () => {
        canceled = true;
        started?.cancel();
      },
    };
  },
});
