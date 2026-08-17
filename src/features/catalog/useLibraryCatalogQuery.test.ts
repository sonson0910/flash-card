import { describe, expect, it } from 'vitest';
import {
  createLibraryCatalogQueryController,
  type LibraryCatalogBrowser,
  type LibraryCatalogTimers,
} from './useLibraryCatalogQuery';

class FakeTimers implements LibraryCatalogTimers {
  private now = 0;
  private nextId = 1;
  private readonly tasks = new Map<number, { at: number; callback: () => void }>();

  setTimeout(callback: () => void, delayMs: number): number {
    const id = this.nextId++;
    this.tasks.set(id, { at: this.now + delayMs, callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.tasks.delete(handle as number);
  }

  advanceBy(milliseconds: number): void {
    const target = this.now + milliseconds;
    while (true) {
      const next = [...this.tasks.entries()]
        .filter(([, task]) => task.at <= target)
        .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
      if (!next) break;
      const [id, task] = next;
      this.tasks.delete(id);
      this.now = task.at;
      task.callback();
    }
    this.now = target;
  }

  get pendingCount(): number {
    return this.tasks.size;
  }
}

class FakeBrowser implements LibraryCatalogBrowser {
  url: string;
  historyState: unknown = { existing: true };
  readonly pushes: Array<{ state: unknown; location: string }> = [];
  private listeners = new Set<() => void>();

  constructor(url: string) {
    this.url = url;
  }

  getCurrentUrl(): string {
    return this.url;
  }

  getHistoryState(): unknown {
    return this.historyState;
  }

  pushState(state: unknown, location: string): void {
    this.historyState = state;
    this.pushes.push({ state, location });
    this.url = new URL(location, this.url).href;
  }

  listenPopState(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  popTo(url: string): void {
    this.url = url;
    this.listeners.forEach(listener => listener());
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

function setup(url = 'https://sonflash.test/library') {
  const browser = new FakeBrowser(url);
  const timers = new FakeTimers();
  const controller = createLibraryCatalogQueryController({ browser, timers });
  controller.start();
  return { browser, timers, controller };
}

describe('library catalog query controller', () => {
  it('hydrates the public model from the URL without exposing React setters', () => {
    const { controller } = setup(
      'https://sonflash.test/library?q=bonjour&difficulty=hard&page=3',
    );

    expect(controller.getSnapshot()).toMatchObject({
      search: 'bonjour',
      debouncedSearch: 'bonjour',
      difficulty: 'All',
      page: 3,
    });
    expect(Object.keys(controller.actions).some(key => key.startsWith('set'))).toBe(false);
  });

  it('debounces search, normalizes mutually exclusive filters, and resets the page', () => {
    const { controller, timers, browser } = setup(
      'https://sonflash.test/library?category=Travel&difficulty=hard&page=4&utm=course#words',
    );

    controller.actions.changeSearch('airport');
    expect(controller.getSnapshot()).toMatchObject({
      search: 'airport',
      debouncedSearch: '',
      category: 'Travel',
      difficulty: 'All',
      page: 1,
    });

    timers.advanceBy(349);
    expect(controller.getSnapshot().debouncedSearch).toBe('');
    timers.advanceBy(1);
    expect(controller.getSnapshot()).toMatchObject({
      search: 'airport',
      debouncedSearch: 'airport',
      category: 'All',
      difficulty: 'All',
      page: 1,
    });

    timers.advanceBy(400);
    expect(browser.pushes).toEqual([
      {
        state: { existing: true, sonflashLibrary: true },
        location: '/library?utm=course&q=airport#words',
      },
    ]);
  });

  it('replaces pending search and URL timers when the user types quickly', () => {
    const { controller, timers, browser } = setup();

    controller.actions.changeSearch('air');
    timers.advanceBy(200);
    controller.actions.changeSearch('airport');
    timers.advanceBy(349);
    expect(controller.getSnapshot().debouncedSearch).toBe('');
    expect(browser.pushes).toHaveLength(0);

    timers.advanceBy(1);
    expect(controller.getSnapshot().debouncedSearch).toBe('airport');
    timers.advanceBy(400);
    expect(browser.pushes.at(-1)?.location).toBe('/library?q=airport');
    expect(browser.pushes).toHaveLength(1);
  });

  it('applies an equality filter after clearing a settled search', () => {
    const { controller, timers } = setup();

    controller.actions.changeSearch('airport');
    timers.advanceBy(350);
    controller.actions.changeSearch('');
    controller.actions.chooseDeck('Week 2');

    expect(controller.getSnapshot()).toMatchObject({
      search: '',
      debouncedSearch: 'airport',
      deck: 'Week 2',
    });

    timers.advanceBy(350);
    expect(controller.getSnapshot()).toMatchObject({
      search: '',
      debouncedSearch: '',
      deck: 'Week 2',
    });
  });

  it('offers intent actions that enforce due-mode exclusion and page boundaries', () => {
    const { controller } = setup(
      'https://sonflash.test/library?category=Travel&deck=Week1&starred=1&page=3',
    );

    controller.actions.chooseDifficulty('due');
    expect(controller.getSnapshot()).toMatchObject({
      category: 'All',
      deck: 'All',
      difficulty: 'due',
      starred: false,
      page: 1,
    });

    controller.actions.chooseCategory('Business');
    expect(controller.getSnapshot().category).toBe('All');
    controller.actions.goToPage(-2);
    expect(controller.getSnapshot().page).toBe(1);
    controller.actions.goToNextPage();
    expect(controller.getSnapshot().page).toBe(2);
    controller.actions.goToPreviousPage();
    expect(controller.getSnapshot().page).toBe(1);
  });

  it('restores a multi-filter URL with the highest-priority equality filter', () => {
    const { controller } = setup(
      'https://sonflash.test/library?category=Travel&deck=Week1&difficulty=easy&pos=noun&starred=1',
    );

    expect(controller.getSnapshot()).toMatchObject({
      category: 'Travel',
      deck: 'All',
      difficulty: 'All',
      partOfSpeech: 'All',
      starred: false,
      date: 'All',
    });
  });

  it('keeps only the explicitly changed equality filter during sequential actions without a date', () => {
    const { controller } = setup('https://sonflash.test/library?category=Travel');

    controller.actions.chooseDeck('Week 2');
    expect(controller.getSnapshot()).toMatchObject({ category: 'All', deck: 'Week 2' });

    controller.actions.chooseDifficulty('hard');
    expect(controller.getSnapshot()).toMatchObject({ deck: 'All', difficulty: 'hard' });

    controller.actions.choosePartOfSpeech('noun');
    expect(controller.getSnapshot()).toMatchObject({ difficulty: 'All', partOfSpeech: 'noun' });

    controller.actions.toggleStarred(true);
    expect(controller.getSnapshot()).toMatchObject({ partOfSpeech: 'All', starred: true });

    controller.actions.chooseCategory('Business');
    expect(controller.getSnapshot()).toMatchObject({ category: 'Business', starred: false });

    controller.actions.chooseCategory('All');
    expect(controller.getSnapshot()).toMatchObject({
      category: 'All', deck: 'All', difficulty: 'All', partOfSpeech: 'All', starred: false,
    });
  });

  it('preserves the active equality filter for date-only changes and clears', () => {
    const { controller } = setup(
      'https://sonflash.test/library?category=Travel&date=2026-08-14',
    );

    controller.actions.chooseDate('2026-08-15');
    expect(controller.getSnapshot()).toMatchObject({
      category: 'Travel',
      deck: 'All',
      starred: false,
      date: '2026-08-15',
      page: 1,
    });

    controller.actions.chooseDate('All');
    expect(controller.getSnapshot()).toMatchObject({
      category: 'Travel',
      date: 'All',
      page: 1,
    });

    controller.actions.chooseDeck('Week 2');
    expect(controller.getSnapshot()).toMatchObject({
      category: 'All',
      deck: 'Week 2',
      date: 'All',
      page: 1,
    });
  });

  it('replaces the complete query atomically for presentation workflows', () => {
    const { controller, timers, browser } = setup(
      'https://sonflash.test/library?q=airport&category=Travel&page=4',
    );

    controller.actions.replaceQuery({
      search: '',
      category: 'All',
      deck: 'All',
      difficulty: 'All',
      partOfSpeech: 'All',
      starred: false,
      date: 'All',
      page: 1,
    });

    expect(controller.getSnapshot()).toEqual({
      search: '',
      debouncedSearch: '',
      category: 'All',
      deck: 'All',
      difficulty: 'All',
      partOfSpeech: 'All',
      starred: false,
      date: 'All',
      page: 1,
    });
    timers.advanceBy(400);
    expect(browser.pushes.at(-1)?.location).toBe('/library');
  });

  it('does not push when the serialized location is already current', () => {
    const { controller, timers, browser } = setup(
      'https://sonflash.test/library?category=Travel&utm=course#words',
    );

    controller.actions.chooseCategory('Travel');
    timers.advanceBy(400);
    expect(browser.pushes).toHaveLength(0);
  });

  it('restores popstate atomically, cancels stale writes, and never echoes history', () => {
    const { controller, timers, browser } = setup(
      'https://sonflash.test/library?category=Travel&page=3',
    );
    controller.actions.changeSearch('stale');
    expect(timers.pendingCount).toBe(2);

    browser.popTo('https://sonflash.test/library?difficulty=due&page=5&utm=back#saved');
    expect(controller.getSnapshot()).toMatchObject({
      search: '',
      debouncedSearch: '',
      difficulty: 'due',
      page: 5,
    });
    expect(timers.pendingCount).toBe(0);

    timers.advanceBy(1_000);
    expect(browser.pushes).toHaveLength(0);
  });

  it('stops listening and clears pending work', () => {
    const { controller, timers, browser } = setup();
    controller.actions.changeSearch('pending');
    expect(browser.listenerCount).toBe(1);

    controller.stop();
    expect(browser.listenerCount).toBe(0);
    expect(timers.pendingCount).toBe(0);
  });
});
