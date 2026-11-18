import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { CardData } from '../../types/card';
import { createRadixDialogPassthroughMock } from '../../testing/radix-dialog-passthrough';
import {
  CreateCardDialog,
  cardCreatorErrorMessage,
  type CreateCardDialogProps,
} from './CreateCardDialog';
import {
  createInitialCardCreatorModel,
  type CardCreateResult,
  type CardCreatorActions,
  type CardCreatorModel,
} from './card-creator-model';

i18n.load('en', {});
i18n.activate('en');

vi.mock('@radix-ui/react-dialog', () => createRadixDialogPassthroughMock());

const card: CardData = {
  id: 'preview-card',
  origin: 'ai',
  word: 'resilient',
  translation: 'kiên cường',
  explanation: 'Able to recover quickly after difficulty.',
  phonetic: '/rɪˈzɪliənt/',
  emoji: '🌿',
  category: 'General',
  audioUrl: null,
  imageUrl: null,
  partOfSpeech: 'adjective',
  cefrLevel: 'C1',
  exampleSentence: 'The team stayed resilient after the launch slipped.',
  exampleTranslation: 'Đội ngũ vẫn kiên cường sau khi lần ra mắt bị trì hoãn.',
  wordFamily: { noun: 'resilience', adv: 'resiliently' },
  customDeck: 'IELTS',
};

const createModel = (patch: Partial<CardCreatorModel> = {}): CardCreatorModel => {
  const initial = createInitialCardCreatorModel();
  return {
    ...initial,
    ...patch,
    draft: { ...initial.draft, ...patch.draft },
  };
};

const actions = (): CardCreatorActions => ({
  open: vi.fn(),
  updateDraft: vi.fn(),
  generatePreview: vi.fn(async (): Promise<CardCreateResult> => ({ status: 'busy' })),
  updatePreview: vi.fn(),
  regenerate: vi.fn(async (): Promise<CardCreateResult> => ({ status: 'busy' })),
  createManualDraft: vi.fn(),
  save: vi.fn(async (): Promise<CardCreateResult> => ({ status: 'busy' })),
  cancel: vi.fn(),
});

const renderDialog = (model: CardCreatorModel): string => {
  const props: CreateCardDialogProps = {
    model,
    actions: actions(),
    deckOptions: [
      { value: 'IELTS', label: 'IELTS' },
      { value: 'Everyday English', label: 'Everyday English' },
      { value: 'Locked deck', label: 'Locked deck', allowed: false, reason: 'Plan limit' },
    ],
  };
  return renderToStaticMarkup(<I18nProvider i18n={i18n}><CreateCardDialog {...props} /></I18nProvider>);
};

describe('CreateCardDialog', () => {
  it('renders no modal while closed and renders the real deck choices when opened', () => {
    expect(renderDialog(createModel({ open: false }))).toBe('');

    const html = renderDialog(createModel({
      open: true,
      draft: { word: 'resilient', context: 'The team stayed resilient.', partOfSpeech: 'adjective', deck: 'IELTS' },
    }));

    expect(html).toContain('Add a word');
    expect(html).toContain('Word or phrase');
    expect(html).toContain('Context sentence');
    expect(html).toContain('value="IELTS"');
    expect(html).toContain('Everyday English');
    expect(html).toContain('Locked deck · Plan limit');
    expect(html).toContain('aria-describedby="create-card-dialog-description"');
    expect(html).not.toMatch(/class="create-card-dialog__primary"[^>]*disabled/);
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain('aria-label="Headword"');
  });

  it('renders the editable staged fields and selected regeneration controls', () => {
    const html = renderDialog(createModel({ open: true, stage: 'preview', preview: card }));

    expect(html).toContain('AI draft');
    expect(html).toContain('Edit the generated details below');
    expect(html).toContain('aria-label="Pronunciation"');
    expect(html).toContain('aria-label="CEFR level"');
    expect(html).toContain('aria-label="Meaning"');
    expect(html).toContain('aria-label="Definition"');
    expect(html).toContain('aria-label="Example sentence"');
    expect(html).toContain('aria-label="Example translation"');
    expect(html).toContain('aria-label="Word family noun"');
    expect(html).toContain('Regenerate selected details');
    expect(html).toContain('Each completed generation uses one AI request');
    expect(html).toContain('Ready after saving');
    expect(html).toContain('Save card');
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain('aria-label="Edit headword"');
  });

  it('labels a manually created preview as a manual draft', () => {
    const html = renderDialog(createModel({
      open: true,
      stage: 'preview',
      mode: 'manual',
      preview: { ...card, origin: 'manual' },
    }));

    expect(html).toContain('Manual draft');
    expect(html).not.toContain('AI draft');
  });

  it('shows loading and quota guidance without replacing the draft', () => {
    const loading = renderDialog(createModel({
      open: true,
      stage: 'generating',
      draft: { word: 'resilient', context: '', partOfSpeech: '', deck: '' },
    }));
    expect(loading).toContain('Generating…');
    expect(loading).toContain('SonFlash is preparing your card');
    expect(loading).toContain('value="resilient"');

    const quota = renderDialog(createModel({
      open: true,
      stage: 'error',
      draft: { word: 'resilient', context: '', partOfSpeech: '', deck: '' },
      error: { code: 'generation', message: 'AI quota exhausted for this period.' },
    }));
    expect(quota).toContain('AI card allowance is used up');
    expect(quota).toContain('Add manually');
    expect(quota).toContain('role="alert"');

    const duplicate = renderDialog(createModel({
      open: true,
      stage: 'error',
      preview: card,
      duplicate: card,
    }));
    expect(duplicate).toContain('already exists in your library');
    expect(duplicate).toMatch(/class="create-card-dialog__primary"[^>]*disabled/);
  });

  it('shows the current AI operation stage in the existing status region', () => {
    const html = renderDialog(createModel({
      open: true,
      stage: 'generating',
      generationStage: 'drafting',
      preview: card,
    }));

    expect(html).toContain('Drafting your card with AI…');
    expect(html).not.toContain('SonFlash is preparing your card');
    expect(html).toContain('role="status"');
  });

  it('keeps a failed partial preview visible but disables saving it', () => {
    const html = renderDialog(createModel({
      open: true,
      stage: 'error',
      preview: card,
      draft: { word: 'resilient', context: '', partOfSpeech: '', deck: '' },
      error: { code: 'generation', message: 'Generation failed.' },
    }));

    expect(html).toContain('AI draft');
    expect(html).toMatch(/class="create-card-dialog__primary"[^>]*disabled/);
  });

  it('offers a real manual card path without exposing unsupported upload controls', () => {
    const html = renderDialog(createModel({ open: true, mode: 'manual' }));

    expect(html).toContain('MANUAL CARD');
    expect(html).toContain('MANUAL DETAILS');
    expect(html).toContain('Your card');
    expect(html).toContain('Meaning');
    expect(html).toContain('Use AI draft');
    expect(html).toContain('Save card');
    expect(html).not.toContain('Generate preview');
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain('Upload image');
  });
});

describe('cardCreatorErrorMessage', () => {
  it('maps structured failures to localized copy and provides a safe fallback', () => {
    expect(cardCreatorErrorMessage({ code: 'generation', message: 'Try the word again.' })).toContain('AI service could not create');
    expect(cardCreatorErrorMessage({ code: 'network' })).toContain('AI service is unavailable');
    expect(cardCreatorErrorMessage(null)).toContain('could not be created');
  });
});
