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
  register: string;
  commonMistake: string;
  imageSearchQuery: string;
}

export interface StoryInfo {
  story: string;
  translation: string;
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
    register: optionalText(source, 'register').slice(0, 40),
    commonMistake: optionalText(source, 'commonMistake'),
    imageSearchQuery: optionalText(source, 'imageSearchQuery').slice(0, 120),
  };
}

export function parseStoryInfo(value: unknown): StoryInfo {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid AI story data');
  const source = value as Record<string, unknown>;
  return {
    story: requiredText(source, 'story').slice(0, 4000),
    translation: requiredText(source, 'translation').slice(0, 4000),
  };
}
