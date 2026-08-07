export const DAILY_LESSON_MODES = [
  'recognition',
  'active-recall',
  'listening',
  'spelling',
  'cloze',
  'sentence-building',
  'placement',
] as const;

export type DailyLessonMode = typeof DAILY_LESSON_MODES[number];
export type DailyLearningView = 'today' | 'catalog' | 'library' | 'progress';

export interface DailyLearningUrlState {
  readonly view: DailyLearningView;
  readonly lesson: DailyLessonMode | null;
}

const isLessonMode = (value: string | null): value is DailyLessonMode => (
  value !== null && (DAILY_LESSON_MODES as readonly string[]).includes(value)
);

const readView = (url: URL): DailyLearningView => {
  if (/^\/library\/?$/.test(url.pathname)) return 'library';
  const view = url.searchParams.get('view');
  return view === 'catalog' || view === 'library' || view === 'progress' || view === 'today'
    ? view
    : 'today';
};

export function readDailyLearningUrlState(location: string): DailyLearningUrlState {
  const url = new URL(location, 'https://sonflash.invalid');
  const view = readView(url);
  const lesson = url.searchParams.get('lesson');
  return {
    view,
    lesson: view === 'today' && isLessonMode(lesson) ? lesson : null,
  };
}

export function createDailyLearningLocation(
  currentLocation: string,
  state: DailyLearningUrlState,
): string {
  const url = new URL(currentLocation, 'https://sonflash.invalid');
  if (/^\/library\/?$/.test(url.pathname)) url.pathname = '/';
  if (state.view === 'today') url.searchParams.delete('view');
  else url.searchParams.set('view', state.view);

  if (state.view === 'today' && state.lesson) url.searchParams.set('lesson', state.lesson);
  else url.searchParams.delete('lesson');
  return `${url.pathname}${url.search}${url.hash}`;
}
