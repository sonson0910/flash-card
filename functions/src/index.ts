import { GoogleGenAI, Type } from '@google/genai';
import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { defineBoolean, defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  InputValidationError,
  parseCreateSharedDeckRequest,
  parseImageRequest,
  parseRevokeSharedDeckRequest,
  parseVocabularyRequest,
} from './inputValidation.js';
import { selectRelevantPexelsImage, type PexelsPhoto } from './imageSelection.js';
import { consumePersistentRateLimit, RateLimitExceededError } from './rateLimiter.js';

const geminiApiKey = defineSecret('GEMINI_API_KEY');
const pexelsApiKey = defineSecret('PEXELS_API_KEY');
const enforceAppCheck = defineBoolean('ENFORCE_APP_CHECK', {
  default: true,
  description: 'Keep Firebase App Check enforced. Set false only for an explicitly isolated local emulator.',
});
const MODEL = 'gemini-3.1-flash-lite';
const REGION = 'asia-southeast1';
const FIRESTORE_DATABASE_ID = 'ai-studio-945b4052-4462-4668-8936-277f09f07a37';
const MAX_AI_CALLS_PER_HOUR = 30;
const MAX_IMAGE_CALLS_PER_HOUR = 120;
const MAX_SHARED_DECK_CREATIONS_PER_HOUR = 20;
const MAX_SHARED_DECK_REVOCATIONS_PER_HOUR = 120;
const SHARED_DECK_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const adminApp = getApps().length > 0 ? getApp() : initializeApp();
const database = getFirestore(adminApp, FIRESTORE_DATABASE_ID);

const requireUser = (auth: { uid: string } | undefined) => {
  if (!auth?.uid) throw new HttpsError('unauthenticated', 'Sign in is required.');
  return auth.uid;
};

const consumeBudget = async (userId: string, scope: string, maximum: number, message: string) => {
  try {
    await consumePersistentRateLimit(database, userId, scope, maximum);
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      throw new HttpsError('resource-exhausted', message, {
        retryAfterSeconds: Math.ceil(error.retryAfterMs / 1_000),
      });
    }
    throw error;
  }
};

const safeText = (value: unknown, maximum: number) => typeof value === 'string'
  ? value.trim().slice(0, maximum)
  : '';

const invalidArgument = (error: unknown): never => {
  if (error instanceof InputValidationError) {
    throw new HttpsError('invalid-argument', error.message);
  }
  throw error;
};

const parseOrInvalidArgument = <T>(parser: () => T): T => {
  try {
    return parser();
  } catch (error) {
    return invalidArgument(error);
  }
};

const parseModelJson = (text: string | undefined) => {
  if (!text) throw new HttpsError('internal', 'AI returned an empty response.');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpsError('internal', 'AI returned an invalid response.');
  }
};

export const generateVocabulary = onCall({
  region: REGION,
  secrets: [geminiApiKey],
  enforceAppCheck,
  timeoutSeconds: 60,
  memory: '256MiB',
  maxInstances: 3,
}, async request => {
  const userId = requireUser(request.auth);
  const input = parseOrInvalidArgument(() => parseVocabularyRequest(request.data));
  await consumeBudget(userId, 'ai', MAX_AI_CALLS_PER_HOUR, 'AI request limit reached. Try again later.');
  const ai = new GoogleGenAI({ apiKey: geminiApiKey.value() });

  if (input.action === 'word') {
    const { word } = input;
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: `You are an English to Vietnamese dictionary and vocabulary teacher.
Provide information for the English word represented by this JSON string: ${JSON.stringify(word)}.
Return concise translation, explanation, explanationTranslation, IPA phonetic, one emoji, category,
partOfSpeech, cefrLevel (A1-C2), exampleSentence, exampleTranslation, up to four collocations,
synonyms and antonyms, register, a concise commonMistake (or empty string), and imageSearchQuery.
imageSearchQuery must be 3-6 concrete English visual keywords for stock-photo search, aligned with the
exact meaning selected above and disambiguating polysemous words. Do not request generated art or styles.`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            translation: { type: Type.STRING }, explanation: { type: Type.STRING },
            explanationTranslation: { type: Type.STRING }, phonetic: { type: Type.STRING },
            emoji: { type: Type.STRING }, category: { type: Type.STRING },
            partOfSpeech: { type: Type.STRING }, cefrLevel: { type: Type.STRING },
            exampleSentence: { type: Type.STRING }, exampleTranslation: { type: Type.STRING },
            collocations: { type: Type.ARRAY, items: { type: Type.STRING } },
            synonyms: { type: Type.ARRAY, items: { type: Type.STRING } },
            antonyms: { type: Type.ARRAY, items: { type: Type.STRING } },
            register: { type: Type.STRING }, commonMistake: { type: Type.STRING },
            imageSearchQuery: { type: Type.STRING },
          },
          required: ['translation', 'explanation', 'explanationTranslation', 'phonetic', 'emoji', 'category',
            'partOfSpeech', 'cefrLevel', 'exampleSentence', 'exampleTranslation', 'collocations', 'synonyms',
            'antonyms', 'register', 'commonMistake', 'imageSearchQuery'],
        },
      },
    });
    return { result: parseModelJson(response.text) };
  }

  if (input.action === 'story') {
    const { words } = input;
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: `Write an engaging English story of at most 150 words using every word in this JSON array naturally: ${JSON.stringify(words)}. Return the story and its Vietnamese translation.`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: { story: { type: Type.STRING }, translation: { type: Type.STRING } },
          required: ['story', 'translation'],
        },
      },
    });
    return { result: parseModelJson(response.text) };
  }

  if (input.action === 'translate') {
    const { text } = input;
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: `Translate the English text represented by this JSON string into clear, natural Vietnamese: ${JSON.stringify(text)}`,
    });
    return { result: safeText(response.text, 2048) };
  }

  throw new HttpsError('invalid-argument', 'Unsupported AI action.');
});

const isTrustedImageUrl = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['images.pexels.com', 'upload.wikimedia.org'].includes(url.hostname);
  } catch {
    return false;
  }
};

export const findVocabularyImage = onCall({
  region: REGION,
  secrets: [pexelsApiKey],
  enforceAppCheck,
  timeoutSeconds: 15,
  memory: '256MiB',
  maxInstances: 5,
}, async request => {
  const userId = requireUser(request.auth);
  const input = parseOrInvalidArgument(() => parseImageRequest(request.data));
  await consumeBudget(userId, 'image', MAX_IMAGE_CALLS_PER_HOUR, 'Image request limit reached. Try again later.');
  const { word, query } = input;

  const pexelsResponse = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=8&orientation=landscape`, {
    headers: { Authorization: pexelsApiKey.value() },
    signal: AbortSignal.timeout(6000),
  }).catch(() => null);
  if (pexelsResponse?.ok) {
    const data = await pexelsResponse.json() as { photos?: PexelsPhoto[] };
    const imageUrl = selectRelevantPexelsImage(Array.isArray(data.photos) ? data.photos : [], query);
    if (imageUrl) return { imageUrl };
  }

  const wikipediaResponse = await fetch(
    `https://en.wikipedia.org/w/api.php?action=query&prop=pageimages&format=json&piprop=thumbnail&pithumbsize=1200&titles=${encodeURIComponent(word)}&origin=*`,
    { signal: AbortSignal.timeout(6000) },
  ).catch(() => null);
  if (wikipediaResponse?.ok) {
    const data = await wikipediaResponse.json() as { query?: { pages?: Record<string, { thumbnail?: { source?: unknown } }> } };
    const pages = data.query?.pages;
    const firstPage = pages ? pages[Object.keys(pages)[0]] : undefined;
    if (isTrustedImageUrl(firstPage?.thumbnail?.source)) return { imageUrl: firstPage.thumbnail.source };
  }
  return { imageUrl: null };
});

export const createSharedDeck = onCall({
  region: REGION,
  enforceAppCheck,
  timeoutSeconds: 15,
  memory: '256MiB',
  maxInstances: 5,
}, async request => {
  const userId = requireUser(request.auth);
  const input = parseOrInvalidArgument(() => parseCreateSharedDeckRequest(request.data));
  await consumeBudget(
    userId,
    'shared-deck-create',
    MAX_SHARED_DECK_CREATIONS_PER_HOUR,
    'Shared-deck creation limit reached. Try again later.',
  );

  const now = Date.now();
  const document = database.collection('shared_decks').doc();
  const expiresAt = Timestamp.fromMillis(now + SHARED_DECK_TTL_MS);
  await document.create({
    authorUid: userId,
    category: input.category,
    cards: input.cards,
    createdAt: Timestamp.fromMillis(now),
    expiresAt,
    schemaVersion: 1,
  });
  return {
    shareId: document.id,
    expiresAt: expiresAt.toDate().toISOString(),
  };
});

export const revokeSharedDeck = onCall({
  region: REGION,
  enforceAppCheck,
  timeoutSeconds: 10,
  memory: '256MiB',
  maxInstances: 5,
}, async request => {
  const userId = requireUser(request.auth);
  const { shareId } = parseOrInvalidArgument(() => parseRevokeSharedDeckRequest(request.data));
  await consumeBudget(
    userId,
    'shared-deck-revoke',
    MAX_SHARED_DECK_REVOCATIONS_PER_HOUR,
    'Shared-deck revocation limit reached. Try again later.',
  );

  const document = database.collection('shared_decks').doc(shareId);
  await database.runTransaction(async transaction => {
    const snapshot = await transaction.get(document);
    if (!snapshot.exists) return;
    if (snapshot.data()?.authorUid !== userId) {
      throw new HttpsError('permission-denied', 'Only the deck author can revoke this share.');
    }
    transaction.delete(document);
  });
  return { revoked: true };
});
