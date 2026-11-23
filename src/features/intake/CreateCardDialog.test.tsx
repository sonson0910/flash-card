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

const actions = (extra: Partial<CardCreatorActions> = {}): CardCreatorActions => ({
  open: vi.fn(),
  updateDraft: vi.fn(),
  generatePreview: vi.fn(async (): Promise<CardCreateResult> => ({ status: 'busy' })),
  updatePreview: vi.fn(),
  regenerate: vi.fn(async (): Promise<CardCreateResult> => ({ status: 'busy' })),
  createManualDraft: vi.fn(),
  save: vi.fn(async (): Promise<CardCreateResult> => ({ status: 'busy' })),
  cancel: vi.fn(),
  ...extra,
});

const renderDialog = (model: CardCreatorModel, extra: Partial<CardCreatorActions> = {}): string => {
  const props: CreateCardDialogProps = {
    model,
    actions: actions(extra),
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
    expect(html).toContain('Each generation that returns details uses one AI request');
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
    expect(loading).toContain('AI is writing your card');
    expect(loading).toContain('<span lang="en">resilient</span>');
    expect(loading).toContain('Deck · Unassigned');
    expect(loading).not.toContain('aria-label="Meaning"');

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

  it('shows the current AI operation stage in the existing status region while regenerating', () => {
    const html = renderDialog(createModel({
      open: true,
      stage: 'generating',
      generationStage: 'drafting',
      preview: card,
      regenerating: ['examples'],
    }));

    expect(html).toContain('Drafting your card with AI…');
    expect(html).not.toContain('SonFlash is preparing your card');
    expect(html).toContain('role="status"');
    expect(html).toContain('Generating…');
    expect(html).not.toContain('AI is writing your card');
    // Only the regenerated examples wait; the other fields stay editable.
    expect(html).toContain('aria-label="Meaning"');
    expect(html).toContain('aria-label="Pronunciation"');
    expect(html).not.toContain('aria-label="Example sentence"');
    expect(html).not.toContain('aria-label="Example translation"');
    expect(html).toContain('create-card-dialog__skeleton');
  });

  it('streams a first generation as steps, placeholders and a progress bar', () => {
    const html = renderDialog(createModel({
      open: true,
      stage: 'generating',
      generationStage: 'drafting',
      draft: { word: 'resilient', context: '', partOfSpeech: '', deck: 'IELTS' },
      preview: { ...card, translation: '', explanation: '', exampleSentence: '', exampleTranslation: '' },
      streamedFields: ['phonetic', 'partOfSpeech', 'cefrLevel'],
    }), { stopGeneration: vi.fn(async (): Promise<CardCreateResult> => ({ status: 'cancelled' })) });

    expect(html).toContain('create-card-dialog--stream');
    expect(html).toContain('AI is writing your card');
    expect(html).toContain('Deck · IELTS');
    expect(html).toContain('<ol class="create-card-dialog__steps" aria-label="Progress">');
    expect(html).toMatch(/is-done"><span[^>]*><svg[\s\S]*?Headword &amp; stress<\/span> <span class="sr-only">done/);
    expect(html).toMatch(/is-done"><span[^>]*><svg[\s\S]*?Pronunciation<\/span> <span class="sr-only">done/);
    expect(html).toMatch(/is-active" aria-current="step">[\s\S]*?Meaning<\/span> <span class="sr-only">in progress/);
    expect(html).toMatch(/is-waiting">[\s\S]*?Example sentence<\/span> <span class="sr-only">waiting/);
    expect(html).toMatch(/is-waiting">[\s\S]*?Image<\/span> <span class="sr-only">waiting/);
    expect(html).toContain('aria-valuenow="2"');
    expect(html).toContain('aria-valuemax="5"');
    expect(html).toContain('aria-valuetext="2 of 5 ready"');
    expect(html).toContain('<strong>2 of 5</strong> ready');
    // Arrived fields are editable at once; fields still being written are placeholders nobody can focus.
    expect(html).toContain('aria-label="Pronunciation"');
    expect(html).toContain('aria-label="CEFR level"');
    expect(html).not.toContain('aria-label="Meaning"');
    expect(html).not.toContain('aria-label="Definition"');
    expect(html).not.toContain('aria-label="Example sentence"');
    expect(html).toMatch(/class="create-card-dialog__skeleton create-card-dialog__skeleton--meaning" aria-hidden="true"/);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Finding an image…');
    expect(html).toContain('You can edit any field as soon as it appears');
    expect(html).toMatch(/<button type="button" class="create-card-dialog__secondary">Cancel<\/button>/);
    expect(html).toMatch(/<button type="button" class="create-card-dialog__primary" disabled="">Save card<\/button>/);
    expect(html).toContain('role="status" aria-live="polite"');
    // No typewriter caret, no time estimate, and the input-layout controls are gone.
    expect(html).not.toMatch(/~\s?\d+\s?s\b/);
    expect(html).not.toContain('caret');
    expect(html).not.toContain('Ready after saving');
    expect(html).not.toContain('Regenerate selected details');
    expect(html).not.toContain('Word or phrase');
  });

  it('offers Try again and Save after a regeneration that delivered details ended before it finished', () => {
    const base = {
      open: true,
      draft: { word: 'resilient', context: '', partOfSpeech: '', deck: '' },
      preview: card,
      regenerating: ['meaning'] as const,
      streamedFields: ['translation'] as const,
    };
    const failed = renderDialog(createModel({
      ...base, stage: 'preview',
      error: { code: 'generation', message: 'The stream closed.' },
      generationOutcome: { kind: 'failed', partial: true, refunded: null },
    }));
    expect(failed).toContain('Try again');
    expect(failed).toContain('Regeneration stopped before it finished. Your card keeps its earlier details, and this request still counts.');
    expect(failed).toContain('Regenerate');
    expect(failed.match(/<button type="submit"[^>]*>/)?.[0]).not.toContain('disabled');

    const stopped = renderDialog(createModel({
      ...base, stage: 'preview',
      error: { code: 'stopped', message: 'Generation stopped.' },
      generationOutcome: { kind: 'stopped', partial: true, refunded: false },
    }));
    expect(stopped).toContain('Try again');
    expect(stopped).toContain('Stopped. Part of the card had already arrived, so this request still counts.');
  });

  it('offers no Try again for a regeneration that finished or never delivered anything', () => {
    const base = {
      open: true,
      draft: { word: 'resilient', context: '', partOfSpeech: '', deck: '' },
      preview: card,
      stage: 'preview' as const,
    };
    expect(renderDialog(createModel({ ...base, regenerating: ['meaning'], generationOutcome: null }))).not.toContain('Try again');
    expect(renderDialog(createModel({
      ...base, regenerating: ['meaning'],
      generationOutcome: { kind: 'stopped', partial: false, refunded: true },
    }))).not.toContain('Try again');
    expect(renderDialog(createModel({ ...base, regenerating: [], generationOutcome: null }))).not.toContain('Try again');
  });

  it('says that a generation which returns details uses one AI request', () => {
    const html = renderDialog(createModel({
      open: true, stage: 'preview', preview: card,
      draft: { word: 'resilient', context: '', partOfSpeech: '', deck: '' },
    }));
    expect(html).toContain('Each generation that returns details uses one AI request');
    expect(html).not.toContain('Each completed generation');
  });

  it('keeps an unfinished card visible, unchecked and unsaveable, with Try again', () => {
    const partial = { ...card, exampleSentence: '', exampleTranslation: '' };
    const failed = renderDialog(createModel({
      open: true,
      stage: 'error',
      draft: { word: 'resilient', context: '', partOfSpeech: '', deck: '' },
      preview: partial,
      streamedFields: ['phonetic', 'partOfSpeech', 'cefrLevel', 'translation', 'explanation'],
      error: { code: 'generation', message: 'The stream closed.' },
      generationOutcome: { kind: 'failed', partial: true, refunded: null },
    }));

    expect(failed).toContain('create-card-dialog--stream');
    expect(failed).toContain('Not checked');
    expect(failed).toContain('Generation stopped before the card was finished. The details shown were not checked.');
    expect(failed).toContain('role="alert"');
    expect(failed).toMatch(/is-stopped">[\s\S]*?Example sentence<\/span> <span class="sr-only">stopped/);
    expect(failed).toContain('aria-valuenow="3"');
    expect(failed).toContain('Try again');
    expect(failed).toContain('Add manually');
    expect(failed).toContain('Close');
    expect(failed).not.toContain('Save card');
    expect(failed).not.toContain('AI is writing your card');
    expect(failed).toContain('No image yet');
    // Missing fields are empty and editable once nothing more is arriving.
    expect(failed).toContain('aria-label="Example sentence"');
    expect(failed).not.toContain('create-card-dialog__skeleton');

    const stoppedCounted = renderDialog(createModel({
      open: true,
      stage: 'error',
      preview: partial,
      streamedFields: ['phonetic'],
      error: { code: 'stopped', message: 'Stopped.' },
      generationOutcome: { kind: 'stopped', partial: true, refunded: false },
    }));
    expect(stoppedCounted).toContain('Stopped. Part of the card had already arrived, so this request still counts.');
    expect(stoppedCounted).not.toContain('could not be created');

    const exhausted = renderDialog(createModel({
      open: true,
      stage: 'error',
      preview: partial,
      streamedFields: ['phonetic'],
      error: { code: 'generation', message: 'Failed.', cause: { reason: 'operation-attempts-exhausted' } },
      generationOutcome: { kind: 'failed', partial: true, refunded: null },
    }));
    expect(exhausted).toContain('This AI request has used all of its retries. Trying again starts a new request.');
  });

  it('says what a stop before any field cost, claiming a refund only when the server confirmed it', () => {
    const stopped = (refunded: boolean | null) => renderDialog(createModel({
      open: true,
      stage: 'input',
      draft: { word: 'resilient', context: '', partOfSpeech: '', deck: '' },
      error: { code: 'stopped', message: 'Stopped.' },
      generationOutcome: { kind: 'stopped', partial: false, refunded },
    }));

    const refunded = stopped(true);
    expect(refunded).toContain('Stopped. This request was not counted.');
    expect(refunded).toContain('role="status"');
    expect(refunded).toContain('value="resilient"');
    expect(refunded).not.toContain('create-card-dialog--stream');
    expect(refunded).not.toContain('could not be created');
    expect(stopped(false)).toContain('Stopped. This request still counts.');
    expect(stopped(null)).toContain('Generation stopped.');
    expect(stopped(null)).not.toContain('not counted');
  });

  it('explains offline generation and offers the manual path', () => {
    const html = renderDialog(createModel({
      open: true,
      stage: 'error',
      draft: { word: 'resilient', context: '', partOfSpeech: '', deck: '' },
      error: { code: 'offline', message: 'Offline.' },
    }));

    expect(html).toContain('You’re offline. Reconnect to generate a card, or add it manually.');
    expect(html).toContain('role="alert"');
    expect(html).toMatch(/role="alert">[\s\S]*?<button type="button">Add manually<\/button>/);
  });

  it('shows the reconnecting state instead of the step spinner text while a retry polls', () => {
    const html = renderDialog(createModel({
      open: true,
      stage: 'generating',
      generationStage: 'retrying',
      draft: { word: 'resilient', context: '', partOfSpeech: '', deck: '' },
    }));

    expect(html).toContain('Reconnecting…');
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
    expect(cardCreatorErrorMessage({ code: 'offline', message: 'Offline.' })).toContain('You’re offline');
    expect(cardCreatorErrorMessage({ code: 'generation', cause: { reason: 'operation-attempts-exhausted' } })).toContain('used all of its retries');
  });
});
