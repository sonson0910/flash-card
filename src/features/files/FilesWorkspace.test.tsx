import { renderToStaticMarkup } from 'react-dom/server';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { describe, expect, it, vi } from 'vitest';
import type { FileLibraryState } from './fileLibrary';
import type { FileListing, FileSummary } from './fileModel';
import { CardPhotoCountNote, canShowOnCards, FilesWorkspaceView, type CardPhotoCount } from './FilesWorkspace';
import { attachFailureCopy } from './fileCopy';
import { FileError } from './filePort';
import { createMemoryFilePort } from './memoryFileAdapter';
import { createUploadSession, type UploadState } from './uploadSession';

i18n.load('en', {});
i18n.activate('en');

const MIB = 1024 * 1024;
const LIMITS = { tier: 'free', limitBytes: 100 * MIB, maxFileBytes: 20 * MIB } as const;
const stored = (overrides: Partial<FileSummary>): FileSummary => ({
  id: 'file-00000000000000000001', name: 'reading.pdf', kind: 'pdf', contentType: 'application/pdf', purpose: 'source',
  courseId: null, status: 'ready', verification: 'complete', bytes: 3 * MIB, declaredBytes: 3 * MIB, rejectionReason: null,
  createdAt: '2026-11-18T08:00:00.000Z', updatedAt: '2026-11-18T08:00:00.000Z', ...overrides,
});
const listing = (files: FileSummary[], usedBytes = files.reduce((sum, file) => sum + (file.bytes ?? 0), 0)): FileListing => ({
  files, usage: { usedBytes, reservedBytes: 0, fileCount: files.length }, limits: LIMITS,
});

const render = (upload: UploadState, library: FileLibraryState, courses = [{ id: 'course-en', label: 'English · IELTS' }], onLoadMore?: () => void) => {
  const session = createUploadSession({ port: createMemoryFilePort({ limits: LIMITS }), limits: () => LIMITS });
  return renderToStaticMarkup(
    <I18nProvider i18n={i18n}>
      <FilesWorkspaceView
        upload={upload}
        session={session}
        library={library}
        courses={courses}
        defaultCourseId={null}
        onRetryList={vi.fn()}
        onLoadMore={onLoadMore}
        onDelete={vi.fn()}
        onOpen={vi.fn()}
      />
    </I18nProvider>,
  );
};

const selection = { name: 'reading.pdf', kind: 'pdf' as const, contentType: 'application/pdf', bytes: 2 * MIB, data: new Blob() };

describe('FilesWorkspaceView', () => {
  it('offers the file chooser with the accepted types and the three sources', () => {
    const html = render({ phase: 'select', kind: null }, { status: 'ready', listing: listing([]) });
    expect(html).toContain('Bring in a <em>source.</em>');
    expect(html).toContain('accept=".pdf,.epub,image/*"');
    expect(html).toContain('aria-label="Choose a PDF, EPUB, or image"');
    expect(html).toContain('Browse files');
    expect(html).toContain('data-kind="epub" aria-pressed="false"');
    expect(html).toContain('No files yet');
    expect(html).not.toContain('WebP');
  });

  it('offers the next page of files only when the service reports more behind the listed ones', () => {
    const more = { ...listing([stored({})]), nextCursor: '1700000000000:AbCdEfGhIjKlMnOpQrSt' };
    expect(render({ phase: 'select', kind: null }, { status: 'ready', listing: more }, undefined, vi.fn())).toContain('Show more files');
    expect(render({ phase: 'select', kind: null }, { status: 'ready', listing: more })).not.toContain('Show more files');
    expect(render({ phase: 'select', kind: null }, { status: 'ready', listing: listing([stored({})]) }, undefined, vi.fn()))
      .not.toContain('Show more files');
  });

  it('mentions the browser resize once an image source is picked', () => {
    expect(render({ phase: 'select', kind: 'image' }, { status: 'ready', listing: listing([]) }))
      .toContain('Images are resized in your browser and saved as WebP.');
  });

  it('names the plan size limit from the service when a file is too large', () => {
    const html = render({ phase: 'rejected', check: 'size', name: 'big.pdf', kind: 'pdf' }, { status: 'ready', listing: listing([]) });
    expect(html).toContain('File is too large');
    expect(html).toContain('Your plan accepts files up to 20 MB.');
    expect(html).toContain('role="alert"');
  });

  it('shows real transfer progress with a cancel action', () => {
    const html = render({ phase: 'uploading', selection, sent: MIB }, { status: 'ready', listing: listing([]) });
    expect(html).toContain('aria-valuenow="50"');
    expect(html).toContain('1 MB of 2 MB');
    expect(html).toContain('Cancel upload');
  });

  it('states the storage limit and what to do, without any plan offer', () => {
    const html = render({ phase: 'quota-exceeded', selection }, { status: 'ready', listing: listing([stored({})], 99 * MIB) });
    expect(html).toContain('Storage allowance reached');
    expect(html).toContain('This file needs 2 MB, and 1 MB of your 100 MB is free.');
    expect(html).toContain('Manage files');
    expect(html).not.toMatch(/compare plan|upgrade|pricing|checkout|pro plan/i);
  });

  it('shows the service rejection reason', () => {
    const html = render({ phase: 'upload-rejected', selection, reason: 'signature' }, { status: 'ready', listing: listing([]) });
    expect(html).toContain('Upload rejected');
    expect(html).toContain('do not match its type');
  });

  it('lets a ready file be attached to one of the learner courses', () => {
    const file = stored({ name: 'reading.pdf' });
    const html = render({ phase: 'results', selection, file }, { status: 'ready', listing: listing([file]) });
    expect(html).toContain('Ready to attach');
    expect(html).toContain('English · IELTS');
    expect(html).toContain('Attach source');
    expect(html).toContain('Open file');
  });

  it('tells the learner when a file that is still being checked cannot be attached yet', () => {
    expect(i18n._(attachFailureCopy('not-ready'))).toContain('still being checked');
    expect(i18n._(attachFailureCopy('not-found'))).toContain('no longer available');
    expect(i18n._(attachFailureCopy('network'))).toContain('could not be attached');
  });

  it('leaves the attach box out when the learner has no courses', () => {
    const file = stored({});
    const html = render({ phase: 'results', selection, file }, { status: 'ready', listing: listing([file]) }, []);
    expect(html).not.toContain('Attach to');
    expect(html).toContain('Upload another');
  });

  it('lists stored files with their status, course and usage from the service', () => {
    const files = [
      stored({}),
      stored({ id: 'file-00000000000000000002', name: 'stories.epub', kind: 'epub', status: 'partial', verification: 'partial', courseId: 'course-en', bytes: MIB }),
    ];
    const html = render({ phase: 'select', kind: null }, { status: 'ready', listing: listing(files) });
    expect(html).toContain('2 files');
    expect(html).toContain('stories.epub');
    expect(html).toContain('EPUB · English · IELTS · 1 MB');
    expect(html).toContain('Partial');
    expect(html).toContain('aria-label="Delete reading.pdf"');
    expect(html).toContain('4 MB of 100 MB used');
  });

  it('names the archived course of a stored file without offering it as an attach target', () => {
    const courses = [{ id: 'course-en', label: 'English' }, { id: 'course-ko', label: 'Korean', archived: true }];
    const file = stored({ name: 'hangul.pdf', courseId: 'course-ko' });
    const shelf = render({ phase: 'select', kind: null }, { status: 'ready', listing: listing([file]) }, courses);
    expect(shelf).toContain('PDF · Korean (archived)');
    expect(shelf).not.toContain('PDF · No course');
    const result = render({ phase: 'results', selection, file }, { status: 'ready', listing: listing([file]) }, courses);
    expect(result).toContain('<option value="course-en">English</option>');
    expect(result).not.toContain('<option value="course-ko">');
  });

  it('shows the list error with a retry', () => {
    const html = render({ phase: 'select', kind: null }, { status: 'error', listing: null, error: new FileError('network') });
    expect(html).toContain('My files could not load');
    expect(html).toContain('Retry list');
  });
});

describe('the delete confirmation card photo line', () => {
  const note = (state: CardPhotoCount) => renderToStaticMarkup(<I18nProvider i18n={i18n}><CardPhotoCountNote state={state} /></I18nProvider>);

  it('looks the cards up only for a photo', () => {
    expect(canShowOnCards(stored({ kind: 'image', contentType: 'image/webp' }))).toBe(true);
    expect(canShowOnCards(stored({}))).toBe(false);
    expect(canShowOnCards(stored({ kind: 'epub' }))).toBe(false);
  });

  it('says the cards are being checked, then the count, in a live region', () => {
    expect(note({ status: 'checking' })).toBe('<span data-card-photo-count="checking" aria-live="polite"> Checking which cards show this photo…</span>');
    expect(note({ status: 'counted', count: 1 })).toContain('> 1 card shows this photo; it will be removed from that card.</span>');
    expect(note({ status: 'counted', count: 3 })).toContain('> 3 cards show this photo; it will be removed from those cards.</span>');
  });

  it('says nothing when no card shows the photo', () => {
    expect(note({ status: 'counted', count: 0 })).toBe('<span data-card-photo-count="counted" aria-live="polite"></span>');
  });

  it('says so when the cards could not be counted, and that deleting checks them first', () => {
    expect(note({ status: 'unknown' })).toContain('The cards that show this photo could not be counted. Deleting checks them again and removes the photo from them first.');
  });
});
