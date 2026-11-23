import { createRoot } from 'react-dom/client';
import { useEffect, useMemo, useState } from 'react';
import '../../src/index.css';
import '../../src/styles/app-bootstrap.css';
import '../../src/features/settings/settings-screen.css';
import { ThemeProvider } from '../../src/features/theme/ThemeProvider';
import { I18nProvider, useUiLocale } from '../../src/i18n/I18nProvider';
import { loadCatalog } from '../../src/i18n/loadCatalog';
import { EditCardDialog } from '../../src/features/cardEdit/EditCardDialog';
import { FilesSettingsSection } from '../../src/features/files/FilesSettingsSection';
import { FilesWorkspace, FilesWorkspaceView, type FileCourseOption } from '../../src/features/files/FilesWorkspace';
import { createCardImageUploader, type FileLibraryState } from '../../src/features/files/fileLibrary';
import type { FileLimits, FileSummary } from '../../src/features/files/fileModel';
import { FileError, type UploadTransfer } from '../../src/features/files/filePort';
import { createMemoryFilePort } from '../../src/features/files/memoryFileAdapter';
import { createUploadSession, type UploadSelection, type UploadState } from '../../src/features/files/uploadSession';
import type { CardData } from '../../src/types/card';

// Fixture data for the upload boards. The numbers are illustrative; product code reads them from
// the file service. Sizes are binary, like the plan limits and the sizes the screens show.
const KB = 1024;
const MB = 1024 * KB;
const LIMITS: FileLimits = { tier: 'free', limitBytes: 8 * MB, maxFileBytes: 5 * MB };
const COURSES: FileCourseOption[] = [{ id: 'course-ielts', label: 'IELTS Academic' }, { id: 'course-general', label: 'General English' }];
const stamp = '2026-11-18T08:00:00.000Z';
const stored = (id: string, name: string, kind: FileSummary['kind'], contentType: string, bytes: number, courseId: string | null, extra: Partial<FileSummary> = {}): FileSummary => ({
  id, name, kind, contentType, purpose: kind === 'image' ? 'card-image' : 'source', courseId, status: 'ready', verification: 'complete',
  bytes, declaredBytes: bytes, rejectionReason: null, createdAt: stamp, updatedAt: stamp, ...extra,
});
const SHELF: FileSummary[] = [
  stored('fixture-file-0000000000000001', 'ielts-reading.pdf', 'pdf', 'application/pdf', Math.round(2.4 * MB), 'course-ielts'),
  stored('fixture-file-0000000000000002', 'short-stories.epub', 'epub', 'application/epub+zip', Math.round(1.1 * MB), 'course-general'),
  stored('fixture-file-0000000000000003', 'card-photo.webp', 'image', 'image/webp', 180 * KB, 'course-ielts'),
];
const listingOf = (files: FileSummary[], reservedBytes = 0): FileLibraryState => ({
  status: 'ready',
  listing: {
    files,
    usage: { usedBytes: files.reduce((sum, file) => sum + (file.bytes ?? 0), 0), reservedBytes, fileCount: files.length },
    limits: LIMITS,
  },
});

const selection = (name: string, kind: UploadSelection['kind'], contentType: string, bytes: number): UploadSelection => ({ name, kind, contentType, bytes, data: new Blob() });
const PDF = selection('ielts-reading.pdf', 'pdf', 'application/pdf', Math.round(2.4 * MB));
const EPUB = selection('short-stories.epub', 'epub', 'application/epub+zip', Math.round(1.1 * MB));
const IMAGE = selection('card-photo.webp', 'image', 'image/webp', 180 * KB);
const BIG = selection('cambridge-practice-tests.pdf', 'pdf', 'application/pdf', Math.round(4.8 * MB));
const sentOf = (part: UploadSelection, fraction: number) => Math.round(part.bytes * fraction);
// A shelf with 2.2 MB left, so either PDF above is over the allowance.
const FULL_SHELF = [...SHELF, stored('fixture-file-0000000000000004', 'listening-scripts.pdf', 'pdf', 'application/pdf', Math.round(2.1 * MB), 'course-ielts')];

/** Each upload board as the upload session state and file shelf it shows. */
const BOARDS: Record<string, { upload: UploadState; library: FileLibraryState }> = {
  Select: { upload: { phase: 'select', kind: null }, library: listingOf(SHELF) },
  SelectEpub: { upload: { phase: 'select', kind: 'epub' }, library: listingOf(SHELF) },
  SelectImage: { upload: { phase: 'select', kind: 'image' }, library: listingOf(SHELF) },
  Validating: { upload: { phase: 'validating', check: 'type', name: 'ielts-reading.pdf', kind: 'pdf' }, library: listingOf(SHELF) },
  Rejected: { upload: { phase: 'rejected', check: 'type', name: 'lesson-notes.txt', kind: null }, library: listingOf(SHELF) },
  RejectSize: { upload: { phase: 'rejected', check: 'size', name: 'scanned-textbook.pdf', kind: 'pdf' }, library: listingOf(SHELF) },
  RejectPlan: { upload: { phase: 'quota-exceeded', selection: PDF }, library: listingOf(FULL_SHELF) },
  Uploading: { upload: { phase: 'uploading', selection: PDF, sent: sentOf(PDF, 0.48) }, library: listingOf(SHELF.slice(1), PDF.bytes) },
  ResizeImage: { upload: { phase: 'uploading', selection: IMAGE, sent: sentOf(IMAGE, 0.4) }, library: listingOf(SHELF.slice(0, 2), IMAGE.bytes) },
  Canceled: { upload: { phase: 'canceled', selection: PDF, sent: sentOf(PDF, 0.4) }, library: listingOf(SHELF.slice(1)) },
  Retry: { upload: { phase: 'retry', selection: PDF, sent: sentOf(PDF, 0.74) }, library: listingOf(SHELF.slice(1)) },
  UploadIncomplete: { upload: { phase: 'upload-incomplete', selection: PDF, sent: PDF.bytes }, library: listingOf(SHELF.slice(1)) },
  UploadRejected: { upload: { phase: 'upload-rejected', selection: PDF, reason: 'signature' }, library: listingOf(SHELF.slice(1)) },
  QuotaExceeded: { upload: { phase: 'quota-exceeded', selection: BIG }, library: listingOf(FULL_SHELF) },
  Processing: { upload: { phase: 'processing', selection: PDF, fileId: SHELF[0]!.id }, library: listingOf(SHELF.slice(1), PDF.bytes) },
  Results: { upload: { phase: 'results', selection: PDF, file: { ...SHELF[0]!, courseId: null } }, library: listingOf([{ ...SHELF[0]!, courseId: null }, ...SHELF.slice(1)]) },
  SavedEpub: { upload: { phase: 'results', selection: EPUB, file: SHELF[1]! }, library: listingOf(SHELF) },
  AttachImage: { upload: { phase: 'results', selection: IMAGE, file: { ...SHELF[2]!, courseId: null } }, library: listingOf([...SHELF.slice(0, 2), { ...SHELF[2]!, courseId: null }]) },
  Partial: {
    upload: { phase: 'partial', selection: EPUB, file: { ...SHELF[1]!, status: 'partial', verification: 'partial' } },
    library: listingOf([SHELF[0]!, { ...SHELF[1]!, status: 'partial', verification: 'partial' }, SHELF[2]!]),
  },
  Empty: { upload: { phase: 'select', kind: null }, library: listingOf([]) },
  Files: { upload: { phase: 'select', kind: null }, library: listingOf(SHELF) },
  Delete: { upload: { phase: 'select', kind: null }, library: listingOf(SHELF) },
  FileError: { upload: { phase: 'select', kind: null }, library: { status: 'error', listing: null, error: new FileError('network') } },
};

const params = new URLSearchParams(location.search);
const noOp = () => undefined;

function BoardView({ board }: { board: string }) {
  const entry = BOARDS[board] ?? BOARDS.Select!;
  const session = useMemo(() => createUploadSession({ port: createMemoryFilePort({ limits: LIMITS, files: SHELF }), limits: () => LIMITS }), []);
  return (
    <FilesWorkspaceView
      upload={entry.upload}
      session={session}
      library={entry.library}
      courses={COURSES}
      defaultCourseId={board === 'SavedEpub' ? 'course-general' : null}
      onRetryList={noOp}
      onDelete={async () => undefined}
      onOpen={async () => 'about:blank'}
      onManageFiles={noOp}
    />
  );
}

/**
 * The live flow on a file service held in memory. `transfer=hold` keeps the transfer at 40 % until
 * it is canceled; `transfer=drop-once` loses the connection on the first attempt.
 */
function JourneyView() {
  const port = useMemo(() => {
    let attempts = 0;
    const mode = params.get('transfer');
    const transfer = (data: Blob, onProgress: (sent: number, total: number) => void): UploadTransfer => {
      attempts += 1;
      if (mode === 'hold') {
        let fail: (error: unknown) => void = noOp;
        const done = new Promise<void>((_resolve, reject) => { fail = reject; });
        setTimeout(() => onProgress(Math.round(data.size * 0.4), data.size), 50);
        return { done, cancel: () => fail(new FileError('canceled')) };
      }
      if (mode === 'drop-once' && attempts === 1) {
        return { done: new Promise((_resolve, reject) => setTimeout(() => { onProgress(Math.round(data.size * 0.7), data.size); reject(new FileError('network')); }, 50)), cancel: noOp };
      }
      return { done: new Promise(resolve => setTimeout(() => { onProgress(data.size, data.size); resolve(); }, 50)), cancel: noOp };
    };
    return createMemoryFilePort({
      limits: params.get('limit') === 'tight' ? { ...LIMITS, limitBytes: 4 * MB } : LIMITS,
      files: SHELF.slice(1),
      courseIds: COURSES.map(course => course.id),
      transfer,
    });
  }, []);
  return <FilesWorkspace port={port} courses={COURSES} sessionOptions={{ pollIntervalMs: 20, pollAttempts: 5 }} />;
}

function SettingsView() {
  const port = useMemo(() => createMemoryFilePort({
    limits: LIMITS,
    files: SHELF,
    listError: params.get('state') === 'error' ? () => new FileError('network') : undefined,
  }), []);
  const [opened, setOpened] = useState(0);
  return (
    <div className="settings-screen" style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
      <FilesSettingsSection port={port} onOpenFiles={() => setOpened(count => count + 1)} />
      <output data-files-opened hidden>{opened}</output>
    </div>
  );
}

const card: CardData = {
  id: 'files-fixture-card', word: 'adapt', normalizedWord: 'adapt', translation: 'thích nghi', explanation: 'To change to suit new conditions.',
  phonetic: '/əˈdæpt/', emoji: '', category: 'IELTS', audioUrl: null, imageUrl: null, language: 'en', translationLanguage: 'vi',
  exampleSentence: 'Students adapt quickly to the new course.',
};

function CardEditView() {
  const uploader = useMemo(() => {
    const port = createMemoryFilePort({ limits: params.get('limit') === 'tight' ? { ...LIMITS, limitBytes: 10 } : LIMITS });
    return createCardImageUploader(port);
  }, []);
  const [open, setOpen] = useState(true);
  return <EditCardDialog card={card} open={open} onOpenChange={setOpen} onSave={noOp} imageUpload={uploader} />;
}

function FilesFixture() {
  const locale = useUiLocale();
  const [ready, setReady] = useState(false);
  const surface = params.get('surface') ?? 'board';
  useEffect(() => {
    void Promise.all([loadCatalog(locale, 'shell'), loadCatalog(locale, 'files'), ...(surface === 'card-edit' ? [loadCatalog(locale, 'library')] : [])]).then(() => setReady(true));
  }, [locale, surface]);
  if (!ready) return null;
  return (
    <main data-files-fixture={surface} style={{ minHeight: '100vh', background: 'var(--sf-canvas)' }}>
      {surface === 'journey' && <JourneyView />}
      {surface === 'settings' && <SettingsView />}
      {surface === 'card-edit' && <CardEditView />}
      {surface === 'board' && <BoardView board={params.get('board') ?? 'Select'} />}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<ThemeProvider><I18nProvider><FilesFixture /></I18nProvider></ThemeProvider>);
