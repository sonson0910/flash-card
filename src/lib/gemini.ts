import { OperationTimeoutError, withTimeout } from './async';
import { app, auth } from './firebase';
import { parseStoryInfo, parseWordInfo, type StoryInfo, type WordInfo } from './wordInfo';

const MODEL = 'gemini-3.1-flash-lite';
const AI_ATTEMPT_TIMEOUT_MS = 10_000;
const AI_MAX_ATTEMPTS = 2;

const getDevelopmentAI = async () => {
  if (!import.meta.env.DEV) throw new Error('Direct Gemini access is disabled in production.');
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error('Gemini is not configured. Add GEMINI_API_KEY and restart the app.');
  const { GoogleGenAI, Type } = await import('@google/genai');
  return { ai: new GoogleGenAI({ apiKey }), Type };
};

const callProductionAI = async <T,>(action: 'word' | 'story' | 'translate', input: unknown): Promise<T> => {
  const { getFunctions, httpsCallable } = await import('firebase/functions');
  if (!app || !auth?.currentUser) {
    throw new Error('Sign in to use AI in production.');
  }
  const functions = getFunctions(app, 'asia-southeast1');
  const callable = httpsCallable<{ action: string; input: unknown }, { result: T }>(functions, 'generateVocabulary');
  const response = await callable({ action, input });
  return response.data.result;
};

export const withNetworkRetry = async <T>(operation: () => Promise<T>): Promise<T> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < AI_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await withTimeout(
        operation(),
        AI_ATTEMPT_TIMEOUT_MS,
        'The AI service took too long to respond. Your word is still here, so please try again.',
      );
    } catch (error) {
      lastError = error;
      const status = typeof error === 'object' && error !== null && 'status' in error
        ? Number((error as { status?: unknown }).status)
        : 0;
      const isRetryable = error instanceof TypeError || error instanceof OperationTimeoutError || status === 429 || status >= 500;
      if (!isRetryable || attempt === AI_MAX_ATTEMPTS - 1) break;
      await new Promise(resolve => setTimeout(resolve, 500 * (2 ** attempt)));
    }
  }
  throw lastError;
};

export async function generateWordInfo(word: string): Promise<WordInfo> {
  const safeWord = word.trim().slice(0, 80);
  if (!import.meta.env.DEV) {
    return parseWordInfo(await withNetworkRetry(() => callProductionAI<unknown>('word', safeWord)));
  }
  const { ai, Type } = await getDevelopmentAI();
  const response = await withNetworkRetry(() => ai.models.generateContent({
    model: MODEL,
    contents: `You are an English to Vietnamese dictionary and vocabulary teacher.
Please provide information for the English word represented by this JSON string: ${JSON.stringify(safeWord)}

- \`translation\`: The Vietnamese translation of the word.
- \`explanation\`: A simple English explanation of the word.
- \`explanationTranslation\`: The Vietnamese translation of the simple English explanation.
- \`phonetic\`: The IPA phonetic transcription (e.g. /hæp.i/).
- \`emoji\`: A single emoji that best represents the word.
- \`category\`: A single word category for this vocabulary (e.g., Nature, Technology, Emotion, Food, Action, etc.).

Also provide practical learning context:
- \`partOfSpeech\`: noun, verb, adjective, adverb, etc.
- \`cefrLevel\`: one of A1, A2, B1, B2, C1, C2.
- \`exampleSentence\` and \`exampleTranslation\`: one natural, concise example and its Vietnamese translation.
- \`collocations\`, \`synonyms\`, \`antonyms\`: short arrays with at most 4 useful items each.
- \`register\`: neutral, formal, informal, technical, or literary.
- \`commonMistake\`: a concise learner warning, or an empty string when none is useful.
- \`imageSearchQuery\`: 3-6 concrete English visual keywords for a stock-photo search. They must depict the exact meaning selected above, disambiguate polysemous words, contain no style instructions, and never request generated art.`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          translation: { type: Type.STRING },
          explanation: { type: Type.STRING },
          explanationTranslation: { type: Type.STRING },
          phonetic: { type: Type.STRING },
          emoji: { type: Type.STRING },
          category: { type: Type.STRING },
          partOfSpeech: { type: Type.STRING },
          cefrLevel: { type: Type.STRING },
          exampleSentence: { type: Type.STRING },
          exampleTranslation: { type: Type.STRING },
          collocations: { type: Type.ARRAY, items: { type: Type.STRING } },
          synonyms: { type: Type.ARRAY, items: { type: Type.STRING } },
          antonyms: { type: Type.ARRAY, items: { type: Type.STRING } },
          register: { type: Type.STRING },
          commonMistake: { type: Type.STRING },
          imageSearchQuery: { type: Type.STRING },
        },
        required: ['translation', 'explanation', 'explanationTranslation', 'phonetic', 'emoji', 'category', 'partOfSpeech', 'cefrLevel', 'exampleSentence', 'exampleTranslation', 'collocations', 'synonyms', 'antonyms', 'register', 'commonMistake', 'imageSearchQuery'],
      },
    },
  }));

  const text = response.text;
  if (!text) {
    throw new Error('Failed to generate content');
  }

  return parseWordInfo(JSON.parse(text));
}

export async function generateStoryContext(words: string[]): Promise<StoryInfo> {
  const safeWords = words.slice(0, 5).map(word => word.trim().slice(0, 80)).filter(Boolean);
  if (!import.meta.env.DEV) {
    return parseStoryInfo(await withNetworkRetry(() => callProductionAI<unknown>('story', safeWords)));
  }
  const { ai, Type } = await getDevelopmentAI();
  const response = await withNetworkRetry(() => ai.models.generateContent({
    model: MODEL,
    contents: `Write a short, engaging story (max 150 words) in English that includes ALL words from this JSON array naturally: ${JSON.stringify(safeWords)}.
Then provide a Vietnamese translation of the story.`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          story: { type: Type.STRING },
          translation: { type: Type.STRING }
        },
        required: ['story', 'translation'],
      },
    }
  }));
  
  const text = response.text;
  if (!text) throw new Error('Failed to generate story');
  return parseStoryInfo(JSON.parse(text));
}

export async function translateText(text: string): Promise<string> {
  const safeText = text.trim().slice(0, 2048);
  if (!import.meta.env.DEV) {
    const translated = await withNetworkRetry(() => callProductionAI<unknown>('translate', safeText));
    return typeof translated === 'string' ? translated.trim().slice(0, 2048) : '';
  }
  const { ai } = await getDevelopmentAI();
  const response = await withNetworkRetry(() => ai.models.generateContent({
    model: MODEL,
    contents: `Translate the English text represented by this JSON string into clear, natural Vietnamese: ${JSON.stringify(safeText)}`,
  }));
  return response.text?.trim().slice(0, 2048) || '';
}
