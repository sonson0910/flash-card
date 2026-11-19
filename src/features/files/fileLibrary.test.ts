import { describe, expect, it, vi } from 'vitest';
import type { FileLimits } from './fileModel';
import { FileError } from './filePort';
import { createCardImageUploader } from './fileLibrary';
import { createMemoryFilePort } from './memoryFileAdapter';

const LIMITS: FileLimits = { tier: 'free', limitBytes: 4096, maxFileBytes: 2048 };
const photo = (bytes: number) => new File([new Uint8Array(bytes)], 'photo.png', { type: 'image/png' });

vi.mock('./imageResize', async original => ({
  ...(await original<typeof import('./imageResize')>()),
  resizeImageForUpload: async (blob: Blob) => ({ blob: new Blob([await blob.arrayBuffer()], { type: 'image/webp' }), contentType: 'image/webp', width: 10, height: 10 }),
}));

describe('card image uploader', () => {
  it('stores the photo as a card image and resolves with its download URL', async () => {
    const port = createMemoryFilePort({ limits: LIMITS });
    port.downloadUrl = vi.fn(async fileId => `https://files.example/${fileId}`);
    const progress = vi.fn();
    const url = await createCardImageUploader(port).upload(photo(512), progress).done;
    const { files } = await port.list();
    expect(files).toEqual([expect.objectContaining({ purpose: 'card-image', contentType: 'image/webp', name: 'photo.webp', status: 'ready' })]);
    expect(url).toBe(`https://files.example/${files[0].id}`);
    expect(progress).toHaveBeenCalledWith(1);
  });

  it('rejects with the storage reason when the allowance is used up', async () => {
    const port = createMemoryFilePort({ limits: { ...LIMITS, limitBytes: 100 } });
    await expect(createCardImageUploader(port).upload(photo(512), vi.fn()).done).rejects.toMatchObject({ kind: 'quota' });
  });

  it('rejects when the file service cannot be reached', async () => {
    const port = createMemoryFilePort({ limits: LIMITS, listError: () => new FileError('network') });
    await expect(createCardImageUploader(port).upload(photo(512), vi.fn()).done).rejects.toMatchObject({ kind: 'network' });
  });
});
