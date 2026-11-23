import { i18n } from '@lingui/core';
import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import { languageProfileForPair } from '../courses/courseLanguageProfile';
import { createCardIntakeController, type CardIntakeControllerPort } from '../intake/cardIntakeController';
import { createSharedDeckCoursePort } from './shareCourseMatching';
import {
  createSharedDeckSessionController,
  type SharedDeckAdapter,
  type SharedDeckBrowser,
} from './sharedDeckSessionController';

i18n.load('en', {});
i18n.activate('en');

class FakeBrowser implements SharedDeckBrowser {
  constructor(public url: string) {}
  getCurrentUrl(): string { return this.url; }
  replaceLocation(location: string): void { this.url = new URL(location, this.url).href; }
}

describe('a shared deck without a language pair', () => {
  it('is refused instead of saved into the active course when the recipient has another language active', async () => {
    // A deck whose cards carry no language pair, as older clients stored it.
    const adapter: SharedDeckAdapter = {
      load: vi.fn(async () => ({
        category: 'IELTS',
        cards: [
          { word: 'apple', translation: 'quả táo' },
          { word: 'banana', translation: 'quả chuối' },
        ],
      })),
      create: vi.fn(),
      revoke: vi.fn(),
    };
    const persistCards = vi.fn(async (cards: readonly CardData[]) => cards.map(card => ({ card, created: true })));
    const port = {
      findExisting: vi.fn(async () => new Map()),
      persistStructured: vi.fn(),
      touchExisting: vi.fn(),
      generate: vi.fn(),
      completeFlat: vi.fn(),
      generateCard: vi.fn(),
      persistCards,
      createConfirmedCatalogCards: vi.fn(),
      applyMedia: vi.fn(),
    } as unknown as CardIntakeControllerPort;
    const intake = createCardIntakeController({ port, language: languageProfileForPair('ko', 'vi') });
    const courseSession = {
      model: {
        profile: {
          activeCourseId: 'course-ko',
          courses: [
            { id: 'course-en', targetLanguage: 'en', nativeLanguage: 'vi', status: 'active' },
            { id: 'course-ko', targetLanguage: 'ko', nativeLanguage: 'vi', status: 'active' },
          ],
        },
      },
      actions: { createCourse: vi.fn(), switchCourse: vi.fn(), reopenCourse: vi.fn() },
    } as unknown as Parameters<typeof createSharedDeckCoursePort>[0];
    const controller = createSharedDeckSessionController({
      adapter,
      intake: { adoptShared: request => intake.adoptSharedDeck(request) as never },
      browser: new FakeBrowser('https://sonflash.test/library?share=share-1'),
      storage: null,
      coursePort: createSharedDeckCoursePort(courseSession),
    });

    await controller.activate('recipient-1');
    expect(controller.getSnapshot().incomingPreview).not.toBeNull();
    const accepted = await controller.actions.acceptShared();

    expect(accepted).toEqual({ status: 'failed' });
    expect(persistCards).not.toHaveBeenCalled();
    expect(courseSession.actions.createCourse).not.toHaveBeenCalled();
    expect(controller.getSnapshot().error).toMatch(/language/i);
  });
});
