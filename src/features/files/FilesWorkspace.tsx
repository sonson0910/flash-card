import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent, type ReactNode, type RefObject } from 'react';
import { Trans, useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { AlertTriangle, BookOpen, FileText, ImageIcon, Trash2, UploadCloud } from 'lucide-react';
import { useFileLibrary, type FileLibraryState } from './fileLibrary';
import {
  CHECK_CHIPS, CHECK_FAILED, CHECK_LABELS, CHECK_PENDING, KIND_LABELS, PHASE_CAPTIONS, REJECTION_DETAILS, REJECTION_FALLBACK,
  STATUS_LABELS, formatMessage,
} from './fileCopy';
import { FILE_INPUT_ACCEPT, formatBytes, type ClientCheck, type FileKind, type FileListing, type FileSummary } from './fileModel';
import { toFileError, type FilePort } from './filePort';
import { StorageUsageMeter } from './StorageUsageMeter';
import { createUploadSession, type UploadPhase, type UploadSession, type UploadSessionOptions, type UploadState } from './uploadSession';
import './files.css';

export interface FileCourseOption {
  readonly id: string;
  readonly label: string;
}

export interface FilesWorkspaceProps {
  /** The signed-in learner's file service. Keep it stable for the life of the mount. */
  readonly port: FilePort;
  /** Courses a stored file can be attached to; the attach box is left out when there are none. */
  readonly courses?: readonly FileCourseOption[];
  readonly defaultCourseId?: string | null;
  /** Shown as "Manage all files" under the list when the host has a fuller files view. */
  readonly onManageFiles?: () => void;
  /** Polling and resizing overrides for tests and fixture pages. */
  readonly sessionOptions?: Pick<UploadSessionOptions, 'pollIntervalMs' | 'pollAttempts' | 'resize'>;
  /** The app shell's view heading: the page title takes it and the focus after a view change. */
  readonly headingRef?: RefObject<HTMLHeadingElement | null>;
  /** Grows with each navigation into the page; a positive value focuses the page title on mount. */
  readonly focusIntent?: number;
}

type Tone = 'neutral' | 'info' | 'warn' | 'danger' | 'ok';

const PHASE_TONES: Record<UploadPhase, Tone> = {
  select: 'neutral', validating: 'info', rejected: 'danger', uploading: 'info', canceled: 'neutral', retry: 'warn',
  'upload-incomplete': 'warn', 'upload-rejected': 'danger', 'quota-exceeded': 'warn', processing: 'info', results: 'ok', partial: 'warn',
};

const KIND_ACCEPT: Record<FileKind, string> = { pdf: '.pdf,application/pdf', epub: '.epub,application/epub+zip', image: 'image/*' };
const CHECK_ORDER: readonly ClientCheck[] = ['type', 'size', 'plan'];

const KindIcon = ({ kind }: { kind: FileKind | null }) => {
  if (kind === 'image') return <ImageIcon aria-hidden="true" />;
  if (kind === 'epub') return <BookOpen aria-hidden="true" />;
  return <FileText aria-hidden="true" />;
};

/** One upload session per mount; it survives re-renders and is reset when the mount goes away. */
const useUploadSession = (port: FilePort, options: Omit<UploadSessionOptions, 'port'>): UploadSession => {
  const latest = useRef(options);
  latest.current = options;
  const session = useMemo(() => createUploadSession({
    ...latest.current,
    port,
    limits: () => latest.current.limits(),
    courseId: () => latest.current.courseId?.() ?? null,
    onChanged: change => latest.current.onChanged?.(change),
  }), [port]);
  useEffect(() => () => { session.reset(); }, [session]);
  return session;
};

/**
 * The learner's upload flow and file shelf: pick a PDF, EPUB or image, watch it go through the
 * device checks, the transfer and the service's verdict, then attach it to a course. Mount it on
 * a signed-in route with the `files` catalog loaded and a port from `createFirebaseFilePort`.
 */
export function FilesWorkspace({ port, courses = [], defaultCourseId = null, onManageFiles, sessionOptions, headingRef, focusIntent = 0 }: FilesWorkspaceProps) {
  const library = useFileLibrary(port);
  useLayoutEffect(() => {
    if (focusIntent > 0) headingRef?.current?.focus({ preventScroll: true });
  }, [focusIntent, headingRef]);
  const listing = library.state.listing;
  const session = useUploadSession(port, {
    ...sessionOptions,
    limits: () => listing?.limits ?? null,
    courseId: () => defaultCourseId,
    onChanged: library.apply,
  });
  const upload = useSyncExternalStore(session.subscribe, session.getState, session.getState);
  return (
    <FilesWorkspaceView
      upload={upload}
      session={session}
      library={library.state}
      courses={courses}
      defaultCourseId={defaultCourseId}
      onRetryList={() => { void library.refresh(); }}
      onDelete={library.remove}
      onOpen={fileId => port.downloadUrl(fileId)}
      onManageFiles={onManageFiles}
      headingRef={headingRef}
    />
  );
}

/** The view without its data hooks: tests and fixture pages render it from a known state. */
export interface FilesWorkspaceViewProps {
  readonly upload: UploadState;
  readonly session: UploadSession;
  readonly library: FileLibraryState;
  readonly courses: readonly FileCourseOption[];
  readonly defaultCourseId: string | null;
  readonly onRetryList: () => void;
  readonly onDelete: (fileId: string) => Promise<void>;
  readonly onOpen: (fileId: string) => Promise<string>;
  readonly onManageFiles?: () => void;
  readonly headingRef?: RefObject<HTMLHeadingElement | null>;
}

export function FilesWorkspaceView({ upload, session, library, courses, defaultCourseId, onRetryList, onDelete, onOpen, onManageFiles, headingRef }: FilesWorkspaceViewProps) {
  const { _ } = useLingui();
  const inputRef = useRef<HTMLInputElement>(null);
  const filesHeadingRef = useRef<HTMLHeadingElement>(null);
  const [accept, setAccept] = useState(FILE_INPUT_ACCEPT);
  const [deleteTarget, setDeleteTarget] = useState<FileSummary | null>(null);
  const titleId = useId();
  const inputId = useId();
  const filesTitleId = useId();

  const browse = useCallback((kind?: FileKind) => {
    const nextAccept = kind ? KIND_ACCEPT[kind] : FILE_INPUT_ACCEPT;
    setAccept(nextAccept);
    if (inputRef.current) {
      inputRef.current.accept = nextAccept;
      inputRef.current.click();
    }
  }, []);
  const choose = useCallback((file: File | undefined) => {
    if (file) void session.choose(file);
  }, [session]);
  const showFiles = useCallback(() => {
    filesHeadingRef.current?.scrollIntoView({ block: 'nearest' });
    filesHeadingRef.current?.focus();
  }, []);

  const phase = upload.phase;
  return (
    <section className="sf-files sf-files-tokens" aria-labelledby={titleId} data-phase={phase}>
      <input
        ref={inputRef}
        id={inputId}
        className="sf-files__input"
        type="file"
        accept={accept}
        tabIndex={-1}
        aria-label={_(msg({ id: 'files.select.input', message: 'Choose a PDF, EPUB, or image' }))}
        onChange={event => {
          choose(event.currentTarget.files?.[0]);
          event.currentTarget.value = '';
        }}
      />
      <div className="sf-files__grid">
        <div className="sf-files__main">
          <header className="sf-files__head">
            <div className="sf-files__intro">
              <p className="sf-files__kicker">
                <Trans {...msg({ id: 'files.page.kicker', message: 'Source files' })} />
                <span className="sf-files__kicker-accent"><Trans {...msg({ id: 'files.page.kicker-flow', message: 'Upload flow' })} /></span>
              </p>
              <h1 id={titleId} ref={headingRef} tabIndex={-1} className="sf-files__title">
                <Trans {...msg({ id: 'files.page.title', message: 'Bring in a <0>source.</0>' })} components={{ 0: <em /> }} />
              </h1>
              <p className="sf-files__lead">
                <Trans {...msg({ id: 'files.page.lead', message: 'Select a PDF, EPUB, or image, then keep its status visible while it becomes part of your study shelf.' })} />
              </p>
            </div>
            <span className="sf-files__chip crystal-chamfer-sm" data-tone={PHASE_TONES[phase]}>{_(PHASE_CAPTIONS[phase])}</span>
          </header>
          <div className="sf-files__card crystal-chamfer">
            <UploadPanel
              upload={upload}
              session={session}
              listing={library.listing}
              courses={courses}
              defaultCourseId={defaultCourseId}
              onBrowse={browse}
              onDropFile={choose}
              onShowFiles={showFiles}
              onOpen={onOpen}
            />
          </div>
        </div>
        <aside className="sf-files__aside crystal-chamfer" aria-labelledby={filesTitleId}>
          <FileShelf
            library={library}
            courses={courses}
            headingId={filesTitleId}
            headingRef={filesHeadingRef}
            onBrowse={() => browse()}
            onRetry={onRetryList}
            onAskDelete={setDeleteTarget}
            onManageFiles={onManageFiles}
          />
          {deleteTarget && (
            <DeleteFileDialog
              file={deleteTarget}
              onCancel={() => setDeleteTarget(null)}
              onConfirm={async () => {
                await onDelete(deleteTarget.id);
                setDeleteTarget(null);
              }}
            />
          )}
        </aside>
      </div>
    </section>
  );
}

interface UploadPanelProps {
  readonly upload: UploadState;
  readonly session: UploadSession;
  readonly listing: FileListing | null;
  readonly courses: readonly FileCourseOption[];
  readonly defaultCourseId: string | null;
  readonly onBrowse: (kind?: FileKind) => void;
  readonly onDropFile: (file: File | undefined) => void;
  readonly onShowFiles: () => void;
  readonly onOpen: (fileId: string) => Promise<string>;
}

function PanelHead({ title, subtitle, chip, tone, mono = false }: { title: ReactNode; subtitle: ReactNode; chip?: ReactNode; tone?: Tone; mono?: boolean }) {
  return (
    <div className="sf-files-panel__head">
      <div className="sf-files-panel__heading">
        <h2>{title}</h2>
        <p data-mono={mono || undefined}>{subtitle}</p>
      </div>
      {chip && <span className="sf-files__chip sf-files__chip--small crystal-chamfer-sm" data-tone={tone}>{chip}</span>}
    </div>
  );
}

function UploadPanel({ upload, session, listing, courses, defaultCourseId, onBrowse, onDropFile, onShowFiles, onOpen }: UploadPanelProps) {
  const { _, i18n } = useLingui();
  const [dragging, setDragging] = useState(false);

  if (upload.phase === 'select') {
    const onDrop = (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragging(false);
      onDropFile(event.dataTransfer.files?.[0]);
    };
    return (
      <div className="sf-files-panel" data-panel="select">
        <PanelHead
          title={<Trans {...msg({ id: 'files.select.title', message: 'Choose a file' })} />}
          subtitle={<Trans {...msg({ id: 'files.select.subtitle', message: 'Quick checks run here first; the service confirms the file after it arrives.' })} />}
        />
        <div
          className="sf-files-drop crystal-chamfer"
          data-dragging={dragging || undefined}
          onDragOver={event => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <span className="sf-files-drop__tile crystal-chamfer-sm"><UploadCloud aria-hidden="true" /></span>
          <h3><Trans {...msg({ id: 'files.select.drop-title', message: 'Select a source' })} /></h3>
          <p><Trans {...msg({ id: 'files.select.drop-detail', message: 'PDF, EPUB, and images go through the same checks. Drop a file here or browse your device.' })} /></p>
          {upload.kind === 'image' && (
            <p className="sf-files-drop__note"><Trans {...msg({ id: 'files.select.image-note', message: 'Images are resized in your browser and saved as WebP.' })} /></p>
          )}
          <button type="button" className="sf-files-button sf-files-button--primary crystal-chamfer-sm" onClick={() => onBrowse(upload.kind ?? undefined)}>
            <Trans {...msg({ id: 'files.select.browse', message: 'Browse files' })} />
          </button>
        </div>
        <div className="sf-files-kinds">
          {(['pdf', 'epub', 'image'] as const).map(kind => (
            <button
              key={kind}
              type="button"
              className="sf-files-kind crystal-chamfer-sm"
              data-kind={kind}
              aria-pressed={upload.kind === kind}
              onClick={() => { session.pickKind(kind); onBrowse(kind); }}
            >
              <span className="sf-files-kind__icon crystal-chamfer-sm" aria-hidden="true"><KindIcon kind={kind} /></span>
              {_(KIND_LABELS[kind])}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (upload.phase === 'validating' || upload.phase === 'rejected') {
    const failed = upload.phase === 'rejected';
    const check = upload.check;
    const index = CHECK_ORDER.indexOf(check);
    const limitText = listing ? formatBytes(listing.limits.maxFileBytes, i18n.locale) : null;
    const heading = failed ? _(CHECK_FAILED[check].heading) : _(CHECK_PENDING[check].heading);
    const detail = !failed ? _(CHECK_PENDING[check].detail)
      : check === 'size' && limitText ? formatMessage(_, CHECK_FAILED.size.detail, { limit: limitText })
        : check === 'size' ? _(msg({ id: 'files.check.size-empty', message: 'This file is empty or could not be read.' }))
          : _(CHECK_FAILED[check].detail);
    const tone: Tone = failed ? 'danger' : 'info';
    return (
      <div className="sf-files-panel" data-panel="validation">
        <PanelHead
          title={<Trans {...msg({ id: 'files.check.title', message: 'Check before sending' })} />}
          subtitle={upload.name}
          mono
          chip={_(CHECK_CHIPS[check])}
          tone={tone}
        />
        <div className="sf-files-status crystal-chamfer-sm" data-tone={tone} role={failed ? 'alert' : 'status'}>
          <span className="sf-files-status__icon" aria-hidden="true">{failed ? '!' : <span className="sf-files-spinner" />}</span>
          <span>
            <strong>{heading}</strong>
            <span className="sf-files-status__detail">{detail}</span>
          </span>
        </div>
        {upload.kind === 'image' && (
          <p className="sf-files-panel__note"><Trans {...msg({ id: 'files.select.image-note', message: 'Images are resized in your browser and saved as WebP.' })} /></p>
        )}
        <ul className="sf-files-checks crystal-chamfer-sm">
          {CHECK_ORDER.map((row, rowIndex) => {
            const rowTone: Tone = rowIndex < index ? 'ok' : rowIndex > index ? 'neutral' : tone;
            const rowDetail = rowIndex < index ? _(msg({ id: 'files.check.passed', message: 'Passed' }))
              : rowIndex > index ? (row === 'plan' ? _(msg({ id: 'files.check.service', message: 'Service decides' })) : _(msg({ id: 'files.check.waiting', message: 'Waiting' })))
                : failed ? _(msg({ id: 'files.check.attention', message: 'Needs attention' })) : _(CHECK_PENDING[row].row);
            return (
              <li key={row} data-tone={rowTone}>
                <span className="sf-files-checks__dot" aria-hidden="true" />
                <span className="sf-files-checks__label">{_(CHECK_LABELS[row])}</span>
                <span className="sf-files-checks__detail">{rowDetail}</span>
              </li>
            );
          })}
        </ul>
        <p className="sf-files-panel__footnote">
          <Trans {...msg({ id: 'files.check.footnote', message: 'Checks here give quick feedback. The service has the final say on type, size, plan, and ownership.' })} />
        </p>
        <div className="sf-files-panel__actions">
          <button type="button" className="sf-files-button crystal-chamfer-sm" onClick={() => (failed && check !== 'plan' ? session.reset() : onBrowse())}>
            {failed && check !== 'plan'
              ? <Trans {...msg({ id: 'files.check.back', message: 'Back' })} />
              : <Trans {...msg({ id: 'files.check.another', message: 'Choose another' })} />}
          </button>
          {failed ? (
            <button
              type="button"
              className="sf-files-button sf-files-button--primary crystal-chamfer-sm"
              onClick={() => (check === 'plan' ? void session.continueToService() : onBrowse())}
            >
              {_(CHECK_FAILED[check].action)}
            </button>
          ) : (
            <button type="button" className="sf-files-button sf-files-button--primary crystal-chamfer-sm" disabled aria-busy="true">
              <Trans {...msg({ id: 'files.check.continue', message: 'Continue' })} />
            </button>
          )}
        </div>
      </div>
    );
  }

  if (upload.phase === 'uploading' || upload.phase === 'canceled' || upload.phase === 'retry' || upload.phase === 'upload-incomplete') {
    const { selection } = upload;
    const percent = selection.bytes > 0 ? Math.round((upload.sent / selection.bytes) * 100) : 0;
    const copy = {
      uploading: {
        heading: msg({ id: 'files.transfer.uploading', message: 'Uploading source' }),
        label: msg({ id: 'files.transfer.uploading-label', message: 'In progress' }),
        status: msg({ id: 'files.transfer.uploading-status', message: 'Sending bytes' }),
        note: msg({ id: 'files.transfer.uploading-note', message: 'Keep this page open while the file uploads. The service confirms it after the transfer.' }),
        helper: msg({ id: 'files.transfer.uploading-helper', message: 'Connection required' }),
      },
      canceled: {
        heading: msg({ id: 'files.transfer.canceled', message: 'Upload canceled' }),
        label: msg({ id: 'files.transfer.canceled-label', message: 'Canceled' }),
        status: msg({ id: 'files.transfer.canceled-status', message: 'Upload stopped' }),
        note: msg({ id: 'files.transfer.canceled-note', message: 'The upload stopped and nothing was saved. Retry starts a new attempt.' }),
        helper: msg({ id: 'files.transfer.canceled-helper', message: 'No bytes are being sent' }),
      },
      retry: {
        heading: msg({ id: 'files.transfer.retry', message: 'Try the upload again' }),
        label: msg({ id: 'files.transfer.retry-label', message: 'Retry' }),
        status: msg({ id: 'files.transfer.retry-status', message: 'The upload was interrupted' }),
        note: msg({ id: 'files.transfer.retry-note', message: 'The connection dropped before the upload finished. Retry starts a new attempt.' }),
        helper: msg({ id: 'files.transfer.kept-helper', message: 'Selected file kept' }),
      },
      'upload-incomplete': {
        heading: msg({ id: 'files.transfer.incomplete', message: 'Upload incomplete' }),
        label: msg({ id: 'files.transfer.incomplete-label', message: 'Incomplete' }),
        status: msg({ id: 'files.transfer.incomplete-status', message: 'Completion was not confirmed' }),
        note: msg({ id: 'files.transfer.incomplete-note', message: 'The transfer ended, but the service did not confirm the file. Retry starts a new attempt.' }),
        helper: msg({ id: 'files.transfer.kept-helper', message: 'Selected file kept' }),
      },
    }[upload.phase];
    const tone: Tone = upload.phase === 'uploading' ? 'info' : upload.phase === 'canceled' ? 'neutral' : 'warn';
    const sizes = formatMessage(_, msg({ id: 'files.transfer.sizes', message: '{sent} of {total}' }), {
      sent: formatBytes(upload.sent, i18n.locale), total: formatBytes(selection.bytes, i18n.locale),
    });
    return (
      <div className="sf-files-panel" data-panel="transfer">
        <PanelHead
          title={_(copy.heading)}
          subtitle={<TransferSubtitle name={selection.name} kind={selection.kind} />}
          chip={_(copy.label)}
          tone={tone}
        />
        <div className="sf-files-status sf-files-status--transfer crystal-chamfer-sm" data-tone={tone} role="status">
          <div className="sf-files-transfer__row">
            {upload.phase === 'uploading' ? <span className="sf-files-spinner" aria-hidden="true" /> : <span className="sf-files-transfer__mark" aria-hidden="true" />}
            <strong>{_(copy.status)}</strong>
            <span className="sf-files-transfer__percent">{i18n.number(percent / 100, { style: 'percent' })}</span>
          </div>
          <div
            className="sf-files-progress"
            role="progressbar"
            aria-label={_(msg({ id: 'files.transfer.progress', message: 'Upload progress' }))}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <span style={{ width: `${percent}%` }} />
          </div>
          <span className="sf-files-transfer__caption">{sizes}</span>
        </div>
        <p className="sf-files-panel__box crystal-chamfer-sm">
          <AlertTriangle aria-hidden="true" />
          <span>{_(copy.note)}</span>
        </p>
        <div className="sf-files-panel__actions sf-files-panel__actions--end">
          <span className="sf-files-panel__helper">{_(copy.helper)}</span>
          {upload.phase === 'uploading' ? (
            <button type="button" className="sf-files-button crystal-chamfer-sm" onClick={() => session.cancel()}>
              <Trans {...msg({ id: 'files.transfer.cancel', message: 'Cancel upload' })} />
            </button>
          ) : (
            <button type="button" className="sf-files-button crystal-chamfer-sm" onClick={() => { void session.retry(); }}>
              <Trans {...msg({ id: 'files.transfer.retry-action', message: 'Retry upload' })} />
            </button>
          )}
        </div>
      </div>
    );
  }

  if (upload.phase === 'upload-rejected' || upload.phase === 'quota-exceeded') {
    const quota = upload.phase === 'quota-exceeded';
    const { selection } = upload;
    const detail = quota
      ? listing
        ? formatMessage(_, msg({ id: 'files.quota.detail', message: 'This file needs {needed}, and {free} of your {limit} is free. Delete files you no longer need, then try again.' }), {
          needed: formatBytes(selection.bytes, i18n.locale),
          free: formatBytes(Math.max(0, listing.limits.limitBytes - listing.usage.usedBytes - listing.usage.reservedBytes), i18n.locale),
          limit: formatBytes(listing.limits.limitBytes, i18n.locale),
        })
        : _(msg({ id: 'files.quota.detail-unknown', message: 'Your storage allowance is used up. Delete files you no longer need, then try again.' }))
      : _(REJECTION_DETAILS[upload.reason] ?? REJECTION_FALLBACK);
    return (
      <div className="sf-files-panel" data-panel={quota ? 'quota' : 'upload-rejected'}>
        <PanelHead
          title={quota
            ? <Trans {...msg({ id: 'files.quota.title', message: 'Storage allowance reached' })} />
            : <Trans {...msg({ id: 'files.rejected.title', message: 'Upload rejected' })} />}
          subtitle={quota
            ? formatMessage(_, msg({ id: 'files.quota.subtitle', message: '{name} · storage checked by the service' }), { name: selection.name })
            : formatMessage(_, msg({ id: 'files.rejected.subtitle', message: '{name} · checked by the service' }), { name: selection.name })}
          chip={quota ? _(msg({ id: 'files.quota.label', message: 'Storage full' })) : _(msg({ id: 'files.rejected.label', message: 'Rejected' }))}
          tone={quota ? 'warn' : 'danger'}
        />
        <div className="sf-files-status sf-files-status--decision crystal-chamfer-sm" data-tone={quota ? 'warn' : 'danger'} role="alert">
          <span className="sf-files-status__icon" aria-hidden="true">!</span>
          <span>
            <strong>
              {quota
                ? <Trans {...msg({ id: 'files.quota.heading', message: 'Your storage is full' })} />
                : <Trans {...msg({ id: 'files.rejected.heading', message: 'The service did not accept this file' })} />}
            </strong>
            <span className="sf-files-status__detail">{detail}</span>
          </span>
        </div>
        <div className="sf-files-panel__actions">
          <button type="button" className="sf-files-button crystal-chamfer-sm" onClick={() => onBrowse()}>
            <Trans {...msg({ id: 'files.rejected.another', message: 'Choose another file' })} />
          </button>
          <button type="button" className="sf-files-button sf-files-button--primary crystal-chamfer-sm" onClick={onShowFiles}>
            {quota
              ? <Trans {...msg({ id: 'files.quota.manage', message: 'Manage files' })} />
              : <Trans {...msg({ id: 'files.rejected.review', message: 'Review My files' })} />}
          </button>
        </div>
      </div>
    );
  }

  if (upload.phase !== 'processing' && upload.phase !== 'results' && upload.phase !== 'partial') return null;
  return (
    <ResultPanel
      upload={upload}
      session={session}
      courses={courses}
      defaultCourseId={defaultCourseId}
      onOpen={onOpen}
    />
  );
}

function TransferSubtitle({ name, kind }: { name: string; kind: FileKind }) {
  const { _ } = useLingui();
  return (
    <>
      <span data-mono>{name}</span>
      {' · '}
      {_(KIND_LABELS[kind])}
      {kind === 'image' && <> · <Trans {...msg({ id: 'files.transfer.resized', message: 'resized to WebP' })} /></>}
    </>
  );
}

function ResultPanel({ upload, session, courses, defaultCourseId, onOpen }: {
  readonly upload: Extract<UploadState, { phase: 'processing' | 'results' | 'partial' }>;
  readonly session: UploadSession;
  readonly courses: readonly FileCourseOption[];
  readonly defaultCourseId: string | null;
  readonly onOpen: (fileId: string) => Promise<string>;
}) {
  const { _, i18n } = useLingui();
  const file = upload.phase === 'processing' ? null : upload.file;
  const [courseId, setCourseId] = useState<string>(file?.courseId ?? defaultCourseId ?? '');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const selectId = useId();
  const { selection } = upload;
  const copy = {
    processing: {
      heading: msg({ id: 'files.result.processing', message: 'Checking the file' }),
      subtitle: msg({ id: 'files.result.processing-subtitle', message: 'The service is confirming the upload.' }),
      label: msg({ id: 'files.result.processing-label', message: 'Processing' }),
      status: msg({ id: 'files.result.processing-status', message: 'Pending' }),
    },
    results: {
      heading: msg({ id: 'files.result.ready', message: 'Ready to attach' }),
      subtitle: msg({ id: 'files.result.ready-subtitle', message: 'Attach it to a course or open it from My files.' }),
      label: msg({ id: 'files.result.ready-label', message: 'Ready' }),
      status: msg({ id: 'files.result.ready-status', message: 'Ready' }),
    },
    partial: {
      heading: msg({ id: 'files.result.partial', message: 'Saved with a partial result' }),
      subtitle: msg({ id: 'files.result.partial-subtitle', message: 'The file is stored; some checks could not finish.' }),
      label: msg({ id: 'files.result.partial-label', message: 'Partial' }),
      status: msg({ id: 'files.result.partial-status', message: 'Partial' }),
    },
  }[upload.phase];
  const tone: Tone = upload.phase === 'processing' ? 'info' : upload.phase === 'results' ? 'ok' : 'warn';
  const verification = !file ? _(msg({ id: 'files.result.pending', message: 'Pending' }))
    : file.verification === 'complete' ? _(msg({ id: 'files.result.complete', message: 'Complete' }))
      : _(msg({ id: 'files.result.partial-value', message: 'Partial' }));
  const tiles = [
    { label: _(msg({ id: 'files.result.record', message: 'File record' })), value: file ? _(msg({ id: 'files.result.stored', message: 'Stored' })) : _(msg({ id: 'files.result.pending', message: 'Pending' })), tone: file ? 'ok' : 'info' },
    { label: _(msg({ id: 'files.result.verification', message: 'Verification' })), value: verification, tone },
    { label: _(msg({ id: 'files.result.size', message: 'Size' })), value: formatBytes(file?.bytes ?? selection.bytes, i18n.locale), tone: 'neutral' as Tone },
  ];

  const attach = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const updated = await session.attach(courseId || null);
      const course = courses.find(option => option.id === updated.courseId);
      setNotice({
        kind: 'ok',
        text: course
          ? formatMessage(_, msg({ id: 'files.result.attached', message: 'Attached to {course}.' }), { course: course.label })
          : _(msg({ id: 'files.result.detached', message: 'Not attached to a course.' })),
      });
    } catch {
      setNotice({ kind: 'error', text: _(msg({ id: 'files.result.attach-failed', message: 'The file could not be attached. Try again.' })) });
    } finally {
      setBusy(false);
    }
  };
  const open = async () => {
    if (!file) return;
    setNotice(null);
    try {
      window.open(await onOpen(file.id), '_blank', 'noopener,noreferrer');
    } catch (error) {
      const failure = toFileError(error);
      setNotice({
        kind: 'error',
        text: failure.kind === 'not-found'
          ? _(msg({ id: 'files.error.not-found', message: 'That file is no longer available.' }))
          : _(msg({ id: 'files.result.open-failed', message: 'The file could not be opened. Try again.' })),
      });
    }
  };

  return (
    <div className="sf-files-panel" data-panel="result">
      <PanelHead title={_(copy.heading)} subtitle={_(copy.subtitle)} chip={_(copy.label)} tone={tone} />
      <div className="sf-files-status sf-files-status--result crystal-chamfer-sm" data-tone={tone} role="status">
        <span className="sf-files-badge crystal-chamfer-sm" data-kind={selection.kind} aria-hidden="true"><KindIcon kind={selection.kind} /></span>
        <span className="sf-files-status__file">
          <strong>{selection.name}</strong>
          <span>{_(KIND_LABELS[selection.kind])} · {formatBytes(file?.bytes ?? selection.bytes, i18n.locale)}</span>
        </span>
        <span className="sf-files-status__state">
          {upload.phase === 'processing' && <span className="sf-files-spinner" aria-hidden="true" />}
          {_(copy.status)}
        </span>
      </div>
      <div className="sf-files-tiles">
        {tiles.map(tile => (
          <div key={tile.label} className="sf-files-tile crystal-chamfer-sm" data-tone={tile.tone}>
            <span>{tile.label}</span>
            <strong>{tile.value}</strong>
          </div>
        ))}
      </div>
      {courses.length > 0 && (
        <div className="sf-files-panel__box sf-files-attach crystal-chamfer-sm">
          <div className="sf-files-attach__row">
            <label htmlFor={selectId}><Trans {...msg({ id: 'files.result.attach-to', message: 'Attach to' })} /></label>
            <select id={selectId} value={courseId} onChange={event => setCourseId(event.currentTarget.value)} disabled={!file || busy}>
              <option value=""><Trans {...msg({ id: 'files.result.no-course', message: 'No course' })} /></option>
              {courses.map(course => <option key={course.id} value={course.id}>{course.label}</option>)}
            </select>
          </div>
          <p><Trans {...msg({ id: 'files.result.attach-note', message: 'Attached files appear with that course in My files.' })} /></p>
        </div>
      )}
      {notice && <p className="sf-files-panel__notice" data-tone={notice.kind} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</p>}
      <div className="sf-files-panel__actions">
        <button type="button" className="sf-files-button crystal-chamfer-sm" disabled={!file} onClick={() => { void open(); }}>
          <Trans {...msg({ id: 'files.result.open', message: 'Open file' })} />
        </button>
        {courses.length > 0 ? (
          <button type="button" className="sf-files-button sf-files-button--primary crystal-chamfer-sm" disabled={!file || busy} onClick={() => { void attach(); }}>
            <Trans {...msg({ id: 'files.result.attach', message: 'Attach source' })} />
          </button>
        ) : (
          <button type="button" className="sf-files-button sf-files-button--primary crystal-chamfer-sm" disabled={upload.phase === 'processing'} onClick={() => session.reset()}>
            <Trans {...msg({ id: 'files.result.another', message: 'Upload another' })} />
          </button>
        )}
      </div>
    </div>
  );
}

interface FileShelfProps {
  readonly library: FileLibraryState;
  readonly courses: readonly FileCourseOption[];
  readonly headingId: string;
  readonly headingRef: RefObject<HTMLHeadingElement | null>;
  readonly onBrowse: () => void;
  readonly onRetry: () => void;
  readonly onAskDelete: (file: FileSummary) => void;
  readonly onManageFiles?: () => void;
}

function FileShelf({ library, courses, headingId, headingRef, onBrowse, onRetry, onAskDelete, onManageFiles }: FileShelfProps) {
  const { _, i18n } = useLingui();
  const listing = library.listing;
  const files = listing?.files ?? [];
  const count = listing?.usage.fileCount ?? 0;
  const courseLabel = (courseId: string | null) => (courseId ? courses.find(course => course.id === courseId)?.label : null)
    ?? _(msg({ id: 'files.shelf.no-course', message: 'No course' }));

  return (
    <div className="sf-files-shelf">
      <div className="sf-files-shelf__head">
        <div>
          <p className="sf-files-shelf__kicker"><Trans {...msg({ id: 'files.shelf.kicker', message: 'Library' })} /></p>
          <h2 id={headingId} ref={headingRef} tabIndex={-1}><Trans {...msg({ id: 'files.shelf.title', message: 'My files' })} /></h2>
        </div>
        {listing && (
          <span className="sf-files__chip sf-files__chip--small crystal-chamfer-sm" data-tone="neutral">
            {formatMessage(_, msg({ id: 'files.shelf.count', message: '{count, plural, one {# file} other {# files}}' }), { count })}
          </span>
        )}
      </div>
      {listing && <StorageUsageMeter className="crystal-chamfer-sm" usage={listing.usage} limits={listing.limits} />}
      {library.status === 'error' ? (
        <div className="sf-files-shelf__state crystal-chamfer-sm" data-tone="danger" role="alert">
          <span className="sf-files-shelf__state-icon" aria-hidden="true">!</span>
          <strong><Trans {...msg({ id: 'files.shelf.error-title', message: 'My files could not load' })} /></strong>
          <p><Trans {...msg({ id: 'files.shelf.error-detail', message: 'Check your connection, then retry the list.' })} /></p>
          <button type="button" className="sf-files-button crystal-chamfer-sm" onClick={onRetry}>
            <Trans {...msg({ id: 'files.shelf.retry', message: 'Retry list' })} />
          </button>
        </div>
      ) : !listing ? (
        <p className="sf-files-shelf__loading" role="status"><Trans {...msg({ id: 'files.shelf.loading', message: 'Loading your files…' })} /></p>
      ) : files.length === 0 ? (
        <div className="sf-files-shelf__state crystal-chamfer-sm" data-tone="neutral">
          <span className="sf-files-shelf__state-icon crystal-chamfer-sm" aria-hidden="true"><FileText /></span>
          <strong><Trans {...msg({ id: 'files.shelf.empty-title', message: 'No files yet' })} /></strong>
          <p><Trans {...msg({ id: 'files.shelf.empty-detail', message: 'Upload a PDF, EPUB, or image to start your source shelf.' })} /></p>
          <button type="button" className="sf-files-button sf-files-button--primary crystal-chamfer-sm" onClick={onBrowse}>
            <Trans {...msg({ id: 'files.shelf.upload', message: 'Upload a source' })} />
          </button>
        </div>
      ) : (
        <>
          <div className="sf-files-shelf__list-head">
            <span><Trans {...msg({ id: 'files.shelf.files', message: 'Files' })} /></span>
            <span><Trans {...msg({ id: 'files.shelf.all-courses', message: 'All courses' })} /></span>
          </div>
          <ul className="sf-files-list crystal-chamfer-sm">
            {files.map(file => (
              <li key={file.id} data-status={file.status}>
                <span className="sf-files-badge crystal-chamfer-sm" data-kind={file.kind} aria-hidden="true"><KindIcon kind={file.kind} /></span>
                <span className="sf-files-list__text">
                  <strong>{file.name}</strong>
                  <span>
                    {_(KIND_LABELS[file.kind])} · {courseLabel(file.courseId)}
                    {file.bytes !== null && <> · {formatBytes(file.bytes, i18n.locale)}</>}
                  </span>
                </span>
                <span className="sf-files-pill" data-status={file.status}>{_(STATUS_LABELS[file.status])}</span>
                <button
                  type="button"
                  className="sf-files-list__delete"
                  aria-label={formatMessage(_, msg({ id: 'files.shelf.delete', message: 'Delete {name}' }), { name: file.name })}
                  onClick={() => onAskDelete(file)}
                >
                  <Trash2 aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {onManageFiles && (
        <button type="button" className="sf-files-button sf-files-shelf__manage crystal-chamfer-sm" onClick={onManageFiles}>
          <Trans {...msg({ id: 'files.shelf.manage', message: 'Manage all files' })} />
        </button>
      )}
    </div>
  );
}

function DeleteFileDialog({ file, onCancel, onConfirm }: { file: FileSummary; onCancel: () => void; onConfirm: () => Promise<void> }) {
  const { _ } = useLingui();
  const keepRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const titleId = useId();
  const detailId = useId();

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    keepRef.current?.focus();
    return () => { previous?.focus?.(); };
  }, []);

  return (
    <div
      className="sf-files-dialog"
      onKeyDown={event => {
        if (event.key === 'Escape' && !busy) onCancel();
        if (event.key === 'Tab') {
          const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
          const first = buttons[0];
          const last = buttons[buttons.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}
    >
      <div className="sf-files-dialog__card crystal-chamfer" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={detailId}>
        <span className="sf-files-dialog__icon crystal-chamfer-sm" aria-hidden="true"><Trash2 /></span>
        <h3 id={titleId}><Trans {...msg({ id: 'files.delete.title', message: 'Delete this file?' })} /></h3>
        <p id={detailId}>
          <Trans {...msg({ id: 'files.delete.detail', message: '<0>{name}</0> will be removed from My files after confirmation.' })} values={{ name: file.name }} components={{ 0: <span data-mono /> }} />
        </p>
        {failed && <p className="sf-files-panel__notice" data-tone="error" role="alert"><Trans {...msg({ id: 'files.delete.failed', message: 'The file could not be deleted. Try again.' })} /></p>}
        <div className="sf-files-dialog__actions">
          <button ref={keepRef} type="button" className="sf-files-button crystal-chamfer-sm" disabled={busy} onClick={onCancel}>
            <Trans {...msg({ id: 'files.delete.keep', message: 'Keep file' })} />
          </button>
          <button
            type="button"
            className="sf-files-button sf-files-button--danger crystal-chamfer-sm"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={async () => {
              setBusy(true);
              setFailed(false);
              try {
                await onConfirm();
              } catch {
                setFailed(true);
                setBusy(false);
              }
            }}
          >
            {_(msg({ id: 'files.delete.confirm', message: 'Delete' }))}
          </button>
        </div>
      </div>
    </div>
  );
}
