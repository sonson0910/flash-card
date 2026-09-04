import { InputValidationError } from './inputValidation.js';

export interface StorySegment {
  english: string;
  vietnamese: string;
}

export interface StoryComprehension {
  question: string;
  options: [string, string, string];
  correctIndex: 0 | 1 | 2;
  explanationVi: string;
}

export interface StoryGrammarExercise {
  label: string;
  explanationVi: string;
  sourceSentence: string;
  prompt: string;
  acceptedAnswer: string;
}

export interface StoryResponse {
  title: string;
  segments: StorySegment[];
  comprehension: StoryComprehension;
  grammar: StoryGrammarExercise;
  retellPrompt: string;
  targetPhrases: string[];
}

const storyInvalid = () => new InputValidationError('Story response is invalid.');

const storyRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw storyInvalid();
  return value as Record<string, unknown>;
};

const exactKeys = (source: Record<string, unknown>, keys: readonly string[]) => {
  const actual = Object.keys(source).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw storyInvalid();
};

const storyText = (source: Record<string, unknown>, key: string, maximum: number): string => {
  const value = source[key];
  if (typeof value !== 'string') throw storyInvalid();
  const text = value.normalize('NFKC').trim();
  if (!text || text.length > maximum) throw storyInvalid();
  return text;
};

const storyTextValue = (value: unknown, maximum: number): string => {
  if (typeof value !== 'string') throw storyInvalid();
  const text = value.normalize('NFKC').trim();
  if (!text || text.length > maximum) throw storyInvalid();
  return text;
};

const normalizedStoryText = (value: string): string => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

const matchesRequestedWord = (target: string, word: string): boolean => {
  const normalizedWord = word.normalize('NFKC').trim().toLowerCase();
  if (!normalizedWord) return false;
  const escapedWord = normalizedWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapedWord}(?:$|[^\\p{L}\\p{N}])`, 'u')
    .test(target.toLowerCase());
};

export function parseStoryResponse(value: unknown, requestedWords: readonly string[] = []): StoryResponse {
  const source = storyRecord(value);
  exactKeys(source, ['title', 'segments', 'comprehension', 'grammar', 'retellPrompt', 'targetPhrases']);
  if (!Array.isArray(source.segments) || source.segments.length < 2 || source.segments.length > 4) throw storyInvalid();

  const segments = source.segments.map(valueItem => {
    const segment = storyRecord(valueItem);
    exactKeys(segment, ['english', 'vietnamese']);
    return {
      english: storyText(segment, 'english', 280),
      vietnamese: storyText(segment, 'vietnamese', 280),
    };
  });

  const comprehensionSource = storyRecord(source.comprehension);
  exactKeys(comprehensionSource, ['question', 'options', 'correctIndex', 'explanationVi']);
  if (!Array.isArray(comprehensionSource.options) || comprehensionSource.options.length !== 3) throw storyInvalid();
  const correctIndex = comprehensionSource.correctIndex;
  if (typeof correctIndex !== 'number' || !Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 2) throw storyInvalid();
  const options = comprehensionSource.options.map(option => storyTextValue(option, 160)) as [string, string, string];
  if (new Set(options.map(normalizedStoryText)).size !== options.length) throw storyInvalid();
  const comprehension: StoryComprehension = {
    question: storyText(comprehensionSource, 'question', 240),
    options,
    correctIndex: correctIndex as 0 | 1 | 2,
    explanationVi: storyText(comprehensionSource, 'explanationVi', 240),
  };

  const grammarSource = storyRecord(source.grammar);
  exactKeys(grammarSource, ['label', 'explanationVi', 'sourceSentence', 'prompt', 'acceptedAnswer']);
  const grammar: StoryGrammarExercise = {
    label: storyText(grammarSource, 'label', 80),
    explanationVi: storyText(grammarSource, 'explanationVi', 240),
    sourceSentence: storyText(grammarSource, 'sourceSentence', 240),
    prompt: storyText(grammarSource, 'prompt', 240),
    acceptedAnswer: storyText(grammarSource, 'acceptedAnswer', 240),
  };

  if (!Array.isArray(source.targetPhrases) || source.targetPhrases.length < 1 || source.targetPhrases.length > 5) throw storyInvalid();
  const targetPhrases = source.targetPhrases.map(target => storyTextValue(target, 100));
  if (new Set(targetPhrases.map(normalizedStoryText)).size !== targetPhrases.length) throw storyInvalid();
  if (requestedWords.length > 0 && targetPhrases.some(target => !requestedWords.some(word => matchesRequestedWord(target, word)))) {
    throw storyInvalid();
  }

  return {
    title: storyText(source, 'title', 120),
    segments,
    comprehension,
    grammar,
    retellPrompt: storyText(source, 'retellPrompt', 240),
    targetPhrases,
  };
}
