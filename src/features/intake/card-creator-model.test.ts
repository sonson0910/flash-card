import { describe, expect, it } from 'vitest';
import { deriveStreamSteps, type CardCreatorModel } from './card-creator-model';

type StepInput = Pick<CardCreatorModel, 'stage' | 'generationStage' | 'streamedFields' | 'generationOutcome'>;

const generating = (patch: Partial<StepInput> = {}): StepInput => ({
  stage: 'generating', generationStage: 'drafting', streamedFields: [], generationOutcome: null, ...patch,
});
const states = (input: StepInput) => deriveStreamSteps(input).steps.map(step => `${step.id}:${step.state}`);

describe('deriveStreamSteps', () => {
  it('marks the first unfinished step active and the rest waiting before any field arrives', () => {
    expect(states(generating())).toEqual([
      'headword:active', 'pronunciation:waiting', 'meaning:waiting', 'example:waiting', 'image:waiting',
    ]);
    expect(deriveStreamSteps(generating())).toMatchObject({ ready: 0, total: 5 });
  });

  it('completes a step only when every field it needs has arrived, in any arrival order', () => {
    const input = generating({ streamedFields: ['translation', 'phonetic', 'explanation', 'partOfSpeech'] });

    expect(states(input)).toEqual([
      'headword:done', 'pronunciation:active', 'meaning:done', 'example:waiting', 'image:waiting',
    ]);
    expect(deriveStreamSteps(input).ready).toBe(2);
  });

  it('completes every text step while the image is being found, and the image step once the card is ready', () => {
    expect(states(generating({ generationStage: 'finding-image' }))).toEqual([
      'headword:done', 'pronunciation:done', 'meaning:done', 'example:done', 'image:active',
    ]);
    expect(deriveStreamSteps({ ...generating(), stage: 'preview', generationStage: null })).toMatchObject({ ready: 5 });
  });

  it('marks unfinished steps stopped after a stop or a failure and leaves none active', () => {
    const input: StepInput = {
      stage: 'error',
      generationStage: null,
      streamedFields: ['phonetic', 'partOfSpeech', 'cefrLevel', 'translation', 'explanation'],
      generationOutcome: { kind: 'stopped', partial: true, refunded: false },
    };

    expect(states(input)).toEqual([
      'headword:done', 'pronunciation:done', 'meaning:done', 'example:stopped', 'image:stopped',
    ]);
    expect(deriveStreamSteps(input).ready).toBe(3);
  });
});
