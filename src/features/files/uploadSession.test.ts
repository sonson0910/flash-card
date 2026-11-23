import { describe, expect, it, vi } from 'vitest';
import type { FileLimits } from './fileModel';
import { FileError, type UploadTransfer } from './filePort';
import type { ResizedImage } from './imageResize';
import { createMemoryFilePort, type MemoryFilePortOptions } from './memoryFileAdapter';
import { createUploadSession, type UploadSessionOptions } from './uploadSession';

const MIB = 1024 * 1024;
const LIMITS: FileLimits = { tier: 'free', limitBytes: 10 * MIB, maxFileBytes: 4 * MIB };

const named = (name: string, type: string, bytes: number) => Object.assign(new Blob([new Uint8Array(bytes)], { type }), { name });

/** A transfer the test finishes, fails or watches being canceled. */
const heldTransfer = () => {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  let progress: (sent: number, total: number) => void = () => undefined;
  const cancel = vi.fn(() => reject(new FileError('canceled')));
  const make = (_data: Blob, onProgress: (sent: number, total: number) => void): UploadTransfer => {
    progress = onProgress;
    return { done: new Promise<void>((res, rej) => { resolve = res; reject = rej; }), cancel };
  };
  return {
    make,
    cancel,
    progress: (sent: number, total: number) => progress(sent, total),
    finish: () => resolve(),
    fail: (error: unknown) => reject(error),
  };
};

const flush = async () => { for (let index = 0; index < 10; index += 1) await Promise.resolve(); };

const setup = (portOptions: Partial<MemoryFilePortOptions> = {}, sessionOptions: Partial<UploadSessionOptions> = {}) => {
  const port = createMemoryFilePort({ limits: LIMITS, ...portOptions });
  const limits = 'limits' in sessionOptions ? sessionOptions.limits! : () => LIMITS;
  const session = createUploadSession({
    port, wait: async () => undefined, pollAttempts: 3, resize: async blob => ({ blob, contentType: 'image/webp', width: 10, height: 10 }),
    ...sessionOptions, limits,
  });
  return { port, session };
};

describe('upload session', () => {
  it('stores a PDF and reports the service result with real usage', async () => {
    const { port, session } = setup();
    await session.choose(named('reading.pdf', 'application/pdf', 2048));
    const state = session.getState();
    expect(state.phase).toBe('results');
    if (state.phase !== 'results') return;
    expect(state.file).toMatchObject({ name: 'reading.pdf', kind: 'pdf', status: 'ready', bytes: 2048 });
    expect((await port.list()).usage).toEqual({ usedBytes: 2048, reservedBytes: 0, fileCount: 1 });
  });

  it('lists the files once per upload and hands each change to the host', async () => {
    const onChanged = vi.fn();
    const { port, session } = setup({}, { onChanged });
    const shown = await port.list();
    const list = vi.spyOn(port, 'list');
    await session.choose(named('reading.pdf', 'application/pdf', 2048));
    expect(list).toHaveBeenCalledOnce();
    expect(onChanged).toHaveBeenCalledTimes(2);
    // The reservation is an edit to the shown listing that takes the usage the service reported, not an
    // estimate added on the device; the listing that settled the upload replaces it.
    const [reserve] = onChanged.mock.calls[0]!;
    const stale = { ...shown, usage: { usedBytes: 0, reservedBytes: 999, fileCount: 7 } };
    expect(reserve(stale)).toEqual({ ...stale, usage: { usedBytes: 0, reservedBytes: 2048, fileCount: 0 } });
    expect(onChanged).toHaveBeenLastCalledWith(expect.objectContaining({
      files: [expect.objectContaining({ name: 'reading.pdf', status: 'ready', bytes: 2048 })],
      usage: { usedBytes: 2048, reservedBytes: 0, fileCount: 1 },
    }));
  });

  it('waits before each check, since the service settles an upload only after the object is stored', async () => {
    const steps: string[] = [];
    const { port, session } = setup({}, { wait: async () => { steps.push('wait'); } });
    const list = port.list.bind(port);
    port.list = async () => { steps.push('list'); return list(); };
    await session.choose(named('reading.pdf', 'application/pdf', 100));
    expect(steps).toEqual(['wait', 'list']);
  });

  it('gives a canceled reservation back on the shown listing without listing again', async () => {
    const transfer = heldTransfer();
    const onChanged = vi.fn();
    const { port, session } = setup({ transfer: transfer.make }, { onChanged });
    const done = session.choose(named('reading.pdf', 'application/pdf', 1000));
    await flush();
    const during = await port.list();
    expect(during.files).toEqual([expect.objectContaining({ name: 'reading.pdf', status: 'uploading' })]);
    const list = vi.spyOn(port, 'list');
    session.cancel();
    await done;
    await flush();
    expect(list).not.toHaveBeenCalled();
    const release = onChanged.mock.calls.at(-1)![0];
    expect(release(during)).toEqual({ ...during, files: [], usage: { usedBytes: 0, reservedBytes: 0, fileCount: 0 } });
  });

  it('puts an attached course on the shown file without listing again', async () => {
    const onChanged = vi.fn();
    const { port, session } = setup({ courseIds: ['course-en'] }, { onChanged });
    await session.choose(named('reading.pdf', 'application/pdf', 100));
    const shown = onChanged.mock.calls.at(-1)![0];
    const list = vi.spyOn(port, 'list');
    await session.attach('course-en');
    expect(list).not.toHaveBeenCalled();
    expect(onChanged.mock.calls.at(-1)![0](shown).files).toEqual([expect.objectContaining({ name: 'reading.pdf', courseId: 'course-en' })]);
  });

  it('refuses a type outside the accepted list before anything is reserved', async () => {
    const prepare = vi.fn();
    const { port, session } = setup();
    port.prepare = prepare;
    await session.choose(named('notes.txt', 'text/plain', 20));
    expect(session.getState()).toMatchObject({ phase: 'rejected', check: 'type', name: 'notes.txt' });
    expect(prepare).not.toHaveBeenCalled();
  });

  it('refuses a file above the plan size on the device', async () => {
    const { session } = setup();
    await session.choose(named('big.pdf', 'application/pdf', 5 * MIB));
    expect(session.getState()).toMatchObject({ phase: 'rejected', check: 'size' });
  });

  it('lets the service decide when the plan limits could not be read', async () => {
    const { session } = setup({}, { limits: () => null });
    await session.choose(named('reading.pdf', 'application/pdf', 100));
    expect(session.getState()).toMatchObject({ phase: 'rejected', check: 'plan' });
    await session.continueToService();
    expect(session.getState().phase).toBe('results');
  });

  it('shows the storage limit when the service refuses the reservation', async () => {
    const { session } = setup({ files: [], limits: { ...LIMITS, limitBytes: 1000, maxFileBytes: 4000 } }, {
      limits: () => ({ ...LIMITS, limitBytes: 1000, maxFileBytes: 4000 }),
    });
    await session.choose(named('reading.pdf', 'application/pdf', 2000));
    expect(session.getState().phase).toBe('quota-exceeded');
  });

  it('reports progress, cancels the transfer and gives the reservation back', async () => {
    const transfer = heldTransfer();
    const { port, session } = setup({ transfer: transfer.make });
    const done = session.choose(named('reading.pdf', 'application/pdf', 1000));
    await flush();
    expect(session.getState()).toMatchObject({ phase: 'uploading', sent: 0 });
    transfer.progress(480, 1000);
    expect(session.getState()).toMatchObject({ phase: 'uploading', sent: 480 });
    expect((await port.list()).usage.reservedBytes).toBe(1000);
    session.cancel();
    await done;
    expect(transfer.cancel).toHaveBeenCalled();
    expect(session.getState()).toMatchObject({ phase: 'canceled', sent: 480 });
    await flush();
    expect((await port.list()).usage).toEqual({ usedBytes: 0, reservedBytes: 0, fileCount: 0 });
  });

  it('offers a retry after a dropped connection and stores the file on the next attempt', async () => {
    let attempts = 0;
    const { port, session } = setup({
      transfer: (data, onProgress) => {
        attempts += 1;
        if (attempts === 1) return { done: Promise.reject(new FileError('network')), cancel() {} };
        return { done: Promise.resolve().then(() => onProgress(data.size, data.size)), cancel() {} };
      },
    });
    await session.choose(named('stories.epub', 'application/epub+zip', 500));
    expect(session.getState().phase).toBe('retry');
    await session.retry();
    expect(session.getState()).toMatchObject({ phase: 'results' });
    expect((await port.list()).files.map(file => file.status)).toEqual(['ready']);
  });

  it('asks again with the same file ID when the answer to a reservation was lost, so the bytes are reserved once', async () => {
    const { port, session } = setup();
    const prepare = port.prepare.bind(port);
    const asked: Array<string | undefined> = [];
    let lostAnswer = true;
    port.prepare = async input => {
      asked.push(input.fileId);
      const prepared = await prepare(input);
      if (lostAnswer) {
        lostAnswer = false;
        throw new FileError('network');
      }
      return prepared;
    };
    await session.choose(named('reading.pdf', 'application/pdf', 2048));
    expect(session.getState().phase).toBe('retry');
    await session.retry();
    expect(session.getState().phase).toBe('results');
    expect(asked).toHaveLength(2);
    expect(asked[0]).toBeTruthy();
    expect(asked[1]).toBe(asked[0]);
    const listing = await port.list();
    expect(listing.files).toHaveLength(1);
    expect(listing.usage).toEqual({ usedBytes: 2048, reservedBytes: 0, fileCount: 1 });
  });

  /** A port whose first answer to a reservation is lost after the service committed it. */
  const losingFirstAnswer = (port: ReturnType<typeof createMemoryFilePort>) => {
    const prepare = port.prepare.bind(port);
    const asked: Array<{ fileId?: string; courseId: string | null }> = [];
    let lostAnswer = true;
    port.prepare = async input => {
      asked.push({ fileId: input.fileId, courseId: input.courseId });
      const prepared = await prepare(input);
      if (lostAnswer) {
        lostAnswer = false;
        throw new FileError('network');
      }
      return prepared;
    };
    return asked;
  };

  it('gives the lost reservation back when the learner picks the file again instead of retrying', async () => {
    const { port, session } = setup();
    const asked = losingFirstAnswer(port);
    await session.choose(named('reading.pdf', 'application/pdf', 2048));
    expect(session.getState().phase).toBe('retry');
    expect((await port.list()).usage.reservedBytes).toBe(2048);
    await session.choose(named('reading.pdf', 'application/pdf', 2048));
    await flush();
    expect(session.getState().phase).toBe('results');
    expect(asked[1]!.fileId).not.toBe(asked[0]!.fileId);
    const listing = await port.list();
    expect(listing.files).toHaveLength(1);
    expect(listing.usage).toEqual({ usedBytes: 2048, reservedBytes: 0, fileCount: 1 });
  });

  it('gives the lost reservation back when the learner leaves instead of retrying', async () => {
    const onChanged = vi.fn();
    const { port, session } = setup({}, { onChanged });
    losingFirstAnswer(port);
    await session.choose(named('reading.pdf', 'application/pdf', 2048));
    expect((await port.list()).usage.reservedBytes).toBe(2048);
    session.reset();
    await flush();
    const listing = await port.list();
    expect(listing.files).toEqual([]);
    expect(listing.usage).toEqual({ usedBytes: 0, reservedBytes: 0, fileCount: 0 });
    expect(onChanged).toHaveBeenCalledWith(expect.any(Function));
  });

  it('asks again for the course the lost request named, even if the active course changed meanwhile', async () => {
    let course: string | null = 'course-en';
    const { port, session } = setup({}, { courseId: () => course });
    const asked = losingFirstAnswer(port);
    await session.choose(named('reading.pdf', 'application/pdf', 2048));
    course = 'course-ko';
    await session.retry();
    expect(session.getState().phase).toBe('results');
    expect(asked.map(request => request.courseId)).toEqual(['course-en', 'course-en']);
    expect(asked[1]!.fileId).toBe(asked[0]!.fileId);
    expect((await port.list()).files).toHaveLength(1);
  });

  it('asks with a new file ID for a different selection or after the upload itself failed', async () => {
    const { port, session } = setup();
    const asked: Array<string | undefined> = [];
    const prepare = port.prepare.bind(port);
    port.prepare = async input => {
      asked.push(input.fileId);
      if (asked.length === 1) throw new FileError('network');
      return prepare(input);
    };
    await session.choose(named('reading.pdf', 'application/pdf', 2048));
    await session.choose(named('other.pdf', 'application/pdf', 1024));
    expect(asked[1]).not.toBe(asked[0]);
  });

  it('shows the service rejection when the stored bytes fail verification', async () => {
    const { session } = setup({ finalize: () => ({ status: 'rejected', reason: 'signature' }) });
    await session.choose(named('reading.pdf', 'application/pdf', 100));
    expect(session.getState()).toMatchObject({ phase: 'upload-rejected', reason: 'signature' });
  });

  it('shows the storage limit when the service settles the upload over quota', async () => {
    const { session } = setup({ finalize: () => ({ status: 'rejected', reason: 'quota' }) });
    await session.choose(named('reading.pdf', 'application/pdf', 100));
    expect(session.getState().phase).toBe('quota-exceeded');
  });

  it('keeps a partial result when only some service checks finished', async () => {
    const { session } = setup({ finalize: () => ({ status: 'partial' }) });
    await session.choose(named('stories.epub', 'application/epub+zip', 100));
    expect(session.getState()).toMatchObject({ phase: 'partial', file: { verification: 'partial' } });
  });

  it('marks the upload incomplete when the service never confirms it, and retries cleanly', async () => {
    let settle = false;
    const { port, session } = setup({ finalize: () => (settle ? { status: 'ready' } : { status: 'pending' }) });
    const onProgress = vi.fn();
    session.subscribe(onProgress);
    await session.choose(named('reading.pdf', 'application/pdf', 300));
    expect(session.getState().phase).toBe('upload-incomplete');
    settle = true;
    await session.retry();
    await flush();
    expect(session.getState().phase).toBe('results');
    const { files, usage } = await port.list();
    expect(files).toHaveLength(1);
    expect(usage).toEqual({ usedBytes: 300, reservedBytes: 0, fileCount: 1 });
  });

  it('stops confirming when the listing is rate limited, and retry keeps the file the service stored', async () => {
    const { port, session } = setup({}, { pollAttempts: 5 });
    const realList = port.list.bind(port);
    let refuse = true;
    const list = vi.fn(async () => {
      if (refuse) throw new FileError('rate-limited');
      return realList();
    });
    port.list = list;
    const remove = vi.spyOn(port, 'remove');

    await session.choose(named('reading.pdf', 'application/pdf', 300));

    expect(list).toHaveBeenCalledTimes(1);
    expect(session.getState().phase).toBe('upload-incomplete');
    const [stored] = (await realList()).files;
    expect(stored).toMatchObject({ status: 'ready' });

    await session.retry();
    expect(remove).not.toHaveBeenCalled();
    expect(session.getState().phase).toBe('upload-incomplete');

    refuse = false;
    await session.retry();
    expect(remove).not.toHaveBeenCalled();
    expect(session.getState()).toMatchObject({ phase: 'results', file: { id: stored!.id } });
    expect((await realList()).files).toHaveLength(1);
  });

  it('cancels a photo while the service is settling it, and gives the stored file back', async () => {
    const { port, session } = setup({ finalize: () => ({ status: 'pending' }) }, { wait: () => new Promise<void>(() => undefined) });
    const done = session.choose(named('reading.pdf', 'application/pdf', 300));
    await flush();
    expect(session.getState().phase).toBe('processing');
    expect((await port.list()).files).toHaveLength(1);

    session.cancel();
    await flush();

    expect(session.getState()).toMatchObject({ phase: 'canceled' });
    expect((await port.list()).usage).toEqual({ usedBytes: 0, reservedBytes: 0, fileCount: 0 });
    void done;
  });

  it('cancels while the service is reserving space, and gives the reservation back once it answers', async () => {
    const { port, session } = setup();
    const prepare = port.prepare.bind(port);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    port.prepare = async input => { await gate; return prepare(input); };
    const done = session.choose(named('reading.pdf', 'application/pdf', 300));
    await flush();
    expect(session.getState().phase).toBe('validating');

    session.cancel();
    release();
    await done;
    await flush();

    expect(session.getState().phase).not.toBe('uploading');
    expect((await port.list()).usage).toEqual({ usedBytes: 0, reservedBytes: 0, fileCount: 0 });
  });

  it('cancels while an image is being resized, and never reserves space', async () => {
    let finishResize!: () => void;
    const resize = vi.fn((blob: Blob) => new Promise<ResizedImage>(resolve => {
      finishResize = () => resolve({ blob, contentType: 'image/webp', width: 10, height: 10 });
    }));
    const { port, session } = setup({}, { resize });
    const prepare = vi.spyOn(port, 'prepare');
    const done = session.choose(named('photo.png', 'image/png', 300));
    await flush();

    session.cancel();
    finishResize();
    await done;

    expect(prepare).not.toHaveBeenCalled();
    expect(session.getState().phase).toBe('select');
  });

  it('resizes images before sending and keeps the encoded type in the name', async () => {
    const resize = vi.fn(async () => ({ blob: new Blob([new Uint8Array(64)], { type: 'image/webp' }), contentType: 'image/webp' as const, width: 1600, height: 900 }));
    const { session } = setup({}, { resize });
    await session.choose(named('photo.heic', 'image/heic', 9 * MIB));
    expect(resize).toHaveBeenCalledOnce();
    expect(session.getState()).toMatchObject({ phase: 'results', file: { name: 'photo.webp', contentType: 'image/webp', bytes: 64 } });
  });

  it('refuses an image the browser cannot decode', async () => {
    const { session } = setup({}, { resize: async () => { throw new Error('decode'); } });
    await session.choose(named('broken.png', 'image/png', 100));
    expect(session.getState()).toMatchObject({ phase: 'rejected', check: 'type' });
  });

  it('attaches a stored file to a course the learner has', async () => {
    const { session } = setup({ courseIds: ['course-en'] });
    await session.choose(named('reading.pdf', 'application/pdf', 100));
    await expect(session.attach('course-en')).resolves.toMatchObject({ courseId: 'course-en' });
    expect(session.getState()).toMatchObject({ phase: 'results', file: { courseId: 'course-en' } });
    await expect(session.attach('course-missing')).rejects.toMatchObject({ kind: 'not-found' });
  });

  it('ignores a superseded attempt when another file is chosen', async () => {
    const transfer = heldTransfer();
    const { session } = setup({ transfer: transfer.make });
    const first = session.choose(named('first.pdf', 'application/pdf', 100));
    await flush();
    const second = session.choose(named('second.txt', 'text/plain', 10));
    await Promise.all([first, second]);
    expect(transfer.cancel).toHaveBeenCalled();
    expect(session.getState()).toMatchObject({ phase: 'rejected', name: 'second.txt' });
  });
});
