export interface WordInfo {
  translation: string;
  explanation: string;
  explanationTranslation: string;
  phonetic: string;
  emoji: string;
  category: string;
  partOfSpeech: string;
  cefrLevel: string;
  exampleSentence: string;
  exampleTranslation: string;
  collocations: string[];
  synonyms: string[];
  antonyms: string[];
  mnemonic?: string;
  wordFamily?: {
    noun?: string;
    verb?: string;
    adj?: string;
    adv?: string;
  };
  register: string;
  commonMistake: string;
  imageSearchQuery: string;
  /** Other common senses of the word, never equal to `translation`. */
  translationAlternatives?: string[];
}

export interface PlainStoryInfo { story: string; translation: string }

export interface StoryInfo {
  title: string;
  segments: StorySegment[];
  comprehension: StoryComprehension;
  grammar: StoryGrammarExercise;
  retellPrompt: string;
  targetPhrases: string[];
}

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

const WORD_INFO_TEXT_LIMITS = {
  translation: 256,
  explanation: 1000,
  explanationTranslation: 1000,
  phonetic: 256,
  emoji: 16,
  category: 60,
  partOfSpeech: 40,
  exampleSentence: 1000,
  exampleTranslation: 1000,
  mnemonic: 1000,
  register: 40,
  commonMistake: 1000,
  imageSearchQuery: 120,
} as const satisfies Partial<Record<keyof WordInfo, number>>;

const WORD_INFO_REQUIRED_FIELDS = [
  'translation', 'explanation', 'explanationTranslation', 'phonetic', 'emoji', 'category',
] as const;

const WORD_INFO_LIST_FIELDS = ['collocations', 'synonyms', 'antonyms'] as const;

export const TRANSLATION_ALTERNATIVES_MAX = 3;
const TRANSLATION_ALTERNATIVE_MAX_LENGTH = 256;

type WordInfoTextField = keyof typeof WORD_INFO_TEXT_LIMITS;
type WordInfoListField = typeof WORD_INFO_LIST_FIELDS[number];
export type WordInfoField = WordInfoTextField | WordInfoListField | 'cefrLevel' | 'wordFamily' | 'translationAlternatives';
export type WordInfoFieldValue = string | string[] | NonNullable<WordInfo['wordFamily']>;

const isTextField = (field: string): field is WordInfoTextField =>
  Object.prototype.hasOwnProperty.call(WORD_INFO_TEXT_LIMITS, field);

const textList = (value: unknown) => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 4).map(item => item.trim().slice(0, 100))
  : [];

const optionalWordFamily = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const obj = value as Record<string, unknown>;
  const noun = typeof obj.noun === 'string' ? obj.noun.trim().slice(0, 100) : undefined;
  const verb = typeof obj.verb === 'string' ? obj.verb.trim().slice(0, 100) : undefined;
  const adj = typeof obj.adj === 'string' ? obj.adj.trim().slice(0, 100) : undefined;
  const adv = typeof obj.adv === 'string' ? obj.adv.trim().slice(0, 100) : undefined;
  if (!noun && !verb && !adj && !adv) return undefined;
  return Object.fromEntries(
    Object.entries({ noun, verb, adj, adv }).filter(([, item]) => Boolean(item)),
  ) as WordInfo['wordFamily'];
};

const comparableTranslation = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();

/**
 * Up to three distinct alternatives, each 1-256 characters, none equal to the card's translation.
 * The card keeps this rule after the learner edits the translation, so callers re-apply it then.
 */
export const normalizeTranslationAlternatives = (value: unknown, translation = ''): string[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const primary = comparableTranslation(translation);
  if (primary) seen.add(primary);
  const alternatives: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const text = item.trim().slice(0, TRANSLATION_ALTERNATIVE_MAX_LENGTH);
    const key = comparableTranslation(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    alternatives.push(text);
    if (alternatives.length === TRANSLATION_ALTERNATIVES_MAX) break;
  }
  return alternatives;
};

/**
 * Normalises one word field exactly as the final card check does, so a streamed value never changes
 * when the complete card arrives. Returns undefined for an unknown field or a value of the wrong type.
 */
export function normalizeWordInfoField(
  field: string,
  value: unknown,
  context: { translation?: string } = {},
): WordInfoFieldValue | undefined {
  if (isTextField(field)) return typeof value === 'string' ? value.trim().slice(0, WORD_INFO_TEXT_LIMITS[field]) : undefined;
  if (field === 'cefrLevel') {
    if (typeof value !== 'string') return undefined;
    const cefr = value.trim().slice(0, 1000).toUpperCase();
    return /^(A1|A2|B1|B2|C1|C2)$/.test(cefr) ? cefr : '';
  }
  if ((WORD_INFO_LIST_FIELDS as readonly string[]).includes(field)) return Array.isArray(value) ? textList(value) : undefined;
  if (field === 'translationAlternatives') {
    return Array.isArray(value) ? normalizeTranslationAlternatives(value, context.translation) : undefined;
  }
  if (field === 'wordFamily') return optionalWordFamily(value);
  return undefined;
}

const fieldText = (source: Record<string, unknown>, field: WordInfoTextField): string => {
  const value = normalizeWordInfoField(field, source[field]);
  return typeof value === 'string' ? value : '';
};

export function parseWordInfo(value: unknown): WordInfo {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid AI word data');
  const source = value as Record<string, unknown>;
  for (const field of WORD_INFO_REQUIRED_FIELDS) {
    if (!fieldText(source, field)) throw new Error('Invalid AI word data');
  }
  const translation = fieldText(source, 'translation');
  const cefrLevel = normalizeWordInfoField('cefrLevel', source.cefrLevel);
  const list = (field: WordInfoListField) => {
    const items = normalizeWordInfoField(field, source[field]);
    return Array.isArray(items) ? items : [];
  };

  return {
    translation,
    explanation: fieldText(source, 'explanation'),
    explanationTranslation: fieldText(source, 'explanationTranslation'),
    phonetic: fieldText(source, 'phonetic'),
    emoji: fieldText(source, 'emoji'),
    category: fieldText(source, 'category'),
    partOfSpeech: fieldText(source, 'partOfSpeech'),
    cefrLevel: typeof cefrLevel === 'string' ? cefrLevel : '',
    exampleSentence: fieldText(source, 'exampleSentence'),
    exampleTranslation: fieldText(source, 'exampleTranslation'),
    collocations: list('collocations'),
    synonyms: list('synonyms'),
    antonyms: list('antonyms'),
    mnemonic: fieldText(source, 'mnemonic') || undefined,
    wordFamily: optionalWordFamily(source.wordFamily),
    register: fieldText(source, 'register'),
    commonMistake: fieldText(source, 'commonMistake'),
    imageSearchQuery: fieldText(source, 'imageSearchQuery'),
    translationAlternatives: normalizeTranslationAlternatives(source.translationAlternatives, translation),
  };
}

export function parseStoryInfo(value: unknown, requestedWords: readonly string[] = []): StoryInfo {
  return parseStoryInfoWithWords(value, requestedWords);
}

const storyError = () => new Error('Invalid AI story data');

const storyRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw storyError();
  return value as Record<string, unknown>;
};

const exactStoryKeys = (source: Record<string, unknown>, keys: readonly string[]) => {
  const actual = Object.keys(source).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw storyError();
};

const storyText = (source: Record<string, unknown>, key: string, maximum: number): string => {
  const value = source[key];
  if (typeof value !== 'string') throw storyError();
  const text = value.normalize('NFKC').trim();
  if (!text || text.length > maximum) throw storyError();
  return text;
};

const storyTextValue = (value: unknown, maximum: number): string => {
  if (typeof value !== 'string') throw storyError();
  const text = value.normalize('NFKC').trim();
  if (!text || text.length > maximum) throw storyError();
  return text;
};

const normalizedStoryText = (value: string): string => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

const storyTargetMatchesWord = (target: string, word: string) => {
  const normalizedWord = word.normalize('NFKC').trim().toLowerCase();
  if (!normalizedWord) return false;
  const escapedWord = normalizedWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapedWord}(?:$|[^\\p{L}\\p{N}])`, 'u')
    .test(target.toLowerCase());
};

const parseStoryInfoWithWords = (value: unknown, requestedWords: readonly string[] = []): StoryInfo => {
  const source = storyRecord(value);
  exactStoryKeys(source, ['title', 'segments', 'comprehension', 'grammar', 'retellPrompt', 'targetPhrases']);

  if (!Array.isArray(source.segments) || source.segments.length < 2 || source.segments.length > 4) throw storyError();
  const segments = source.segments.map(segmentValue => {
    const segment = storyRecord(segmentValue);
    exactStoryKeys(segment, ['english', 'vietnamese']);
    return {
      english: storyText(segment, 'english', 280),
      vietnamese: storyText(segment, 'vietnamese', 280),
    };
  });

  const comprehensionSource = storyRecord(source.comprehension);
  exactStoryKeys(comprehensionSource, ['question', 'options', 'correctIndex', 'explanationVi']);
  if (!Array.isArray(comprehensionSource.options) || comprehensionSource.options.length !== 3) throw storyError();
  const correctIndex = comprehensionSource.correctIndex;
  if (typeof correctIndex !== 'number' || !Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 2) throw storyError();
  const options = comprehensionSource.options.map(option => storyTextValue(option, 160)) as [string, string, string];
  if (new Set(options.map(normalizedStoryText)).size !== options.length) throw storyError();
  const comprehension: StoryComprehension = {
    question: storyText(comprehensionSource, 'question', 240),
    options,
    correctIndex: correctIndex as 0 | 1 | 2,
    explanationVi: storyText(comprehensionSource, 'explanationVi', 240),
  };

  const grammarSource = storyRecord(source.grammar);
  exactStoryKeys(grammarSource, ['label', 'explanationVi', 'sourceSentence', 'prompt', 'acceptedAnswer']);
  const grammar: StoryGrammarExercise = {
    label: storyText(grammarSource, 'label', 80),
    explanationVi: storyText(grammarSource, 'explanationVi', 240),
    sourceSentence: storyText(grammarSource, 'sourceSentence', 240),
    prompt: storyText(grammarSource, 'prompt', 240),
    acceptedAnswer: storyText(grammarSource, 'acceptedAnswer', 240),
  };

  if (!Array.isArray(source.targetPhrases) || source.targetPhrases.length < 1 || source.targetPhrases.length > 5) throw storyError();
  const targetPhrases = source.targetPhrases.map(target => storyTextValue(target, 100));
  if (new Set(targetPhrases.map(normalizedStoryText)).size !== targetPhrases.length) throw storyError();
  if (requestedWords.length > 0 && targetPhrases.some(target => !requestedWords.some(word => storyTargetMatchesWord(target, word)))) {
    throw storyError();
  }

  return {
    title: storyText(source, 'title', 120),
    segments,
    comprehension,
    grammar,
    retellPrompt: storyText(source, 'retellPrompt', 240),
    targetPhrases,
  };
};

const requiredText = (source: Record<string, unknown>, key: string) => {
  const value = source[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid AI word data');
  return value.trim().slice(0, 1000);
};

export function parsePlainStoryInfo(value: unknown): PlainStoryInfo {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid AI story data');
  const source = value as Record<string, unknown>;
  return { story: requiredText(source, 'story'), translation: requiredText(source, 'translation') };
}
