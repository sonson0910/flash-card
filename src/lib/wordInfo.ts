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
}

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

const requiredText = (source: Record<string, unknown>, key: string) => {
  const value = source[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid AI word data');
  return value.trim().slice(0, 1000);
};

const optionalText = (source: Record<string, unknown>, key: string) =>
  typeof source[key] === 'string' ? source[key].trim().slice(0, 1000) : '';

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
    Object.entries({ noun, verb, adj, adv }).filter(([, item]) => item !== undefined),
  ) as WordInfo['wordFamily'];
};

export function parseWordInfo(value: unknown): WordInfo {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid AI word data');
  const source = value as Record<string, unknown>;
  const cefr = optionalText(source, 'cefrLevel').toUpperCase();

  return {
    translation: requiredText(source, 'translation').slice(0, 256),
    explanation: requiredText(source, 'explanation'),
    explanationTranslation: requiredText(source, 'explanationTranslation'),
    phonetic: requiredText(source, 'phonetic').slice(0, 256),
    emoji: requiredText(source, 'emoji').slice(0, 16),
    category: requiredText(source, 'category').slice(0, 60),
    partOfSpeech: optionalText(source, 'partOfSpeech').slice(0, 40),
    cefrLevel: /^(A1|A2|B1|B2|C1|C2)$/.test(cefr) ? cefr : '',
    exampleSentence: optionalText(source, 'exampleSentence'),
    exampleTranslation: optionalText(source, 'exampleTranslation'),
    collocations: textList(source.collocations),
    synonyms: textList(source.synonyms),
    antonyms: textList(source.antonyms),
    mnemonic: optionalText(source, 'mnemonic') || undefined,
    wordFamily: optionalWordFamily(source.wordFamily),
    register: optionalText(source, 'register').slice(0, 40),
    commonMistake: optionalText(source, 'commonMistake'),
    imageSearchQuery: optionalText(source, 'imageSearchQuery').slice(0, 120),
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
