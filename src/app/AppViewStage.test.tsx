import { PassThrough } from 'node:stream';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { createRef, type ComponentProps } from 'react';
import { renderToPipeableStream } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Course } from '../features/courses/courseModel';
import { createMemoryFilePort } from '../features/files/memoryFileAdapter';
import { ThemeProvider } from '../features/theme/ThemeProvider';
import { fileCourseOptions } from './app-runtime-shared';
import { AppViewStage } from './AppViewStage';

i18n.load('en', {});
i18n.activate('en');

type StageProps = ComponentProps<typeof AppViewStage>;

const LIMITS = { tier: 'free', limitBytes: 8 * 1024 * 1024, maxFileBytes: 4 * 1024 * 1024 } as const;

/** The props the My files and settings branches read; the other views' props are not rendered here. */
const stageProps = (overrides: Partial<StageProps>): StageProps => ({
  viewMode: 'files',
  ownerId: 'owner-a',
  headingRef: createRef<HTMLHeadingElement>(),
  focusIntent: 0,
  settingsSection: 'appearance',
  openSettings: vi.fn(),
  filePort: createMemoryFilePort({ limits: LIMITS }),
  fileCourses: [{ id: 'course-ko', label: 'Korean' }],
  activeCourseId: 'course-ko',
  openFiles: vi.fn(),
  ...overrides,
} as StageProps);

/** Renders after the lazy view and its catalog have loaded. */
const renderStage = (props: StageProps) => new Promise<string>((resolve, reject) => {
  const { pipe } = renderToPipeableStream(<I18nProvider i18n={i18n}><ThemeProvider><AppViewStage {...props} /></ThemeProvider></I18nProvider>, {
    onAllReady() {
      const stream = new PassThrough();
      const chunks: Buffer[] = [];
      stream.on('data', chunk => chunks.push(Buffer.from(chunk)));
      stream.on('end', () => resolve(Buffer.concat(chunks).toString()));
      pipe(stream);
    },
    onShellError: reject,
    onError: reject,
  });
});

const course = (id: string, targetLanguage: Course['targetLanguage'], status: Course['status']): Course => ({
  id, targetLanguage, nativeLanguage: 'vi', status, goals: [], createdAt: '2026-11-19T00:00:00.000Z',
  preferences: { pronunciationVariant: null, showRomanization: false, zhScript: null },
});

describe('AppViewStage My files', () => {
  it('renders the files page with its own focusable page title', async () => {
    const html = await renderStage(stageProps({}));
    expect(html).toContain('data-async-content="files"');
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toMatch(/<h1 id="[^"]+" tabindex="-1" class="sf-files__title">Bring in a <em>source.<\/em><\/h1>/);
    expect(html).toContain('Loading your files…');
    expect(html).not.toContain('Manage all files');
  });

  it('renders nothing for the files view without a file service', async () => {
    expect(await renderStage(stageProps({ filePort: null }))).toBe('');
  });

  it('gives the settings screen the same file service for its storage section', async () => {
    const html = await renderStage(stageProps({ viewMode: 'settings', settingsSection: 'files' }));
    expect(html).toContain('data-async-content="settings"');
    expect(html).toContain('Storage and files');
    expect(html).toContain('Open My files');
  });

  it('offers the active courses, named by the language they teach, as attach targets', () => {
    const courses = [course('course-ko', 'ko', 'active'), course('course-ja', 'ja', 'archived'), course('course-en', 'en', 'active')];
    expect(fileCourseOptions(courses, i18n._.bind(i18n))).toEqual([
      { id: 'course-ko', label: 'Korean' },
      { id: 'course-en', label: 'English' },
    ]);
  });
});
