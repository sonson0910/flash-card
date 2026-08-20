import { GoogleGenAI, Type } from '@google/genai';
import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { defineBoolean, defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { createAiGenerationConfig } from './aiGeneration.js';
import {
  getVocabularyAiBudget,
  isVocabularyAiRateLimitScope,
} from './aiRequestBudget.js';
import runtimeTarget from './runtime-target.json';
import {
  InputValidationError,
  parseCreateSharedDeckRequest,
  parseImageRequest,
  parseLegacyLibraryMigrationRequest,
  parseRevokeSharedDeckRequest,
  parseVocabularyRequest,
} from './inputValidation.js';
import {
  LegacyLibraryInvalidCardsError,
  runLegacyLibraryMigration,
} from './legacyLibraryMigration.js';
import {
  createFirestoreLegacyLibraryMigrationStore,
  LegacyLibraryGenerationChangedError,
} from './legacyLibraryMigrationFirestore.js';
import {
  isImageProviderUnavailable,
  selectRelevantPexelsImage,
  selectRelevantUnsplashImage,
  type PexelsPhoto,
  type UnsplashPhoto,
} from './imageSelection.js';
import {
  consumeRateLimitWithMemoryFallback,
  consumePersistentRateLimit,
  createMemoryRateLimitStore,
  RateLimitExceededError,
} from './rateLimiter.js';
import {
  buildSharedDeckDocuments,
  createSharedDeckAtomically,
  revokeSharedDeckAtomically,
  SHARED_DECK_COLLECTION,
  SHARED_DECK_OWNER_COLLECTION,
  SharedDeckOwnershipError,
} from './sharedDeckPersistence.js';

const geminiApiKey = defineSecret('GEMINI_API_KEY');
const pexelsApiKey = defineSecret('PEXELS_API_KEY');
const unsplashApiKey = defineSecret('UNSPLASH_API_KEY');
const enforceAppCheck = defineBoolean('ENFORCE_APP_CHECK', {
  default: true,
  description: 'Keep Firebase App Check enforced. Set false only for an explicitly isolated local emulator.',
});
const MODEL = 'gemini-3.1-flash-lite';
const REGION = 'asia-southeast1';
const FIRESTORE_DATABASE_ID = runtimeTarget.firestoreDatabaseId;
const MAX_IMAGE_CALLS_PER_HOUR = 120;
const IMAGE_SEARCH_DEADLINE_MS = 12_000;
const IMAGE_PROVIDER_TIMEOUT_MS = 4_000;
const MAX_SHARED_DECK_CREATIONS_PER_HOUR = 20;
const MAX_SHARED_DECK_REVOCATIONS_PER_HOUR = 120;
const SHARED_DECK_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const adminApp = getApps().length > 0 ? getApp() : initializeApp();
const database = getFirestore(adminApp, FIRESTORE_DATABASE_ID);
const legacyLibraryMigrationStore = createFirestoreLegacyLibraryMigrationStore(database);
const memoryRateLimit = createMemoryRateLimitStore();
let memoryRateLimitFallbackReported = false;

const requireUser = (auth: { uid: string } | undefined) => {
  if (!auth?.uid) throw new HttpsError('unauthenticated', 'Sign in is required.');
  return auth.uid;
};

const consumeBudget = async (userId: string, scope: string, maximum: number, message: string) => {
  try {
    if (isVocabularyAiRateLimitScope(scope)) {
      const storage = await consumeRateLimitWithMemoryFallback(
        () => consumePersistentRateLimit(database, userId, scope, maximum),
        () => memoryRateLimit.consume(userId, scope, maximum),
      );
      if (storage === 'memory' && !memoryRateLimitFallbackReported) {
        memoryRateLimitFallbackReported = true;
        console.warn('Firestore rate-limit storage reached quota or timed out; using the bounded AI memory fallback.');
      }
      return;
    }
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
  maxInstances: 1,
}, async request => {
  const userId = requireUser(request.auth);
  const input = parseOrInvalidArgument(() => parseVocabularyRequest(request.data));
  const budget = getVocabularyAiBudget(input.action);
  await consumeBudget(userId, budget.scope, budget.maximum, budget.message);
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
      config: createAiGenerationConfig('word', {
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
      }),
    });
    return { result: parseModelJson(response.text) };
  }

  if (input.action === 'story') {
    const { words } = input;
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: `Write an engaging English story of at most 150 words using every word in this JSON array naturally: ${JSON.stringify(words)}. Return the story and its Vietnamese translation.`,
      config: createAiGenerationConfig('story', {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: { story: { type: Type.STRING }, translation: { type: Type.STRING } },
          required: ['story', 'translation'],
        },
      }),
    });
    return { result: parseModelJson(response.text) };
  }

  if (input.action === 'translate') {
    const { text } = input;
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: `Translate the English text represented by this JSON string into clear, natural Vietnamese: ${JSON.stringify(text)}`,
      config: createAiGenerationConfig('translate'),
    });
    return { result: safeText(response.text, 2048) };
  }

  throw new HttpsError('invalid-argument', 'Unsupported AI action.');
});

const isTrustedImageUrl = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['images.pexels.com', 'images.unsplash.com', 'upload.wikimedia.org'].includes(url.hostname);
  } catch {
    return false;
  }
};

export const findVocabularyImage = onCall({
  region: REGION,
  secrets: [pexelsApiKey, unsplashApiKey],
  enforceAppCheck,
  timeoutSeconds: 15,
  memory: '256MiB',
  maxInstances: 5,
}, async request => {
  const userId = requireUser(request.auth);
  const input = parseOrInvalidArgument(() => parseImageRequest(request.data));
  await consumeBudget(userId, 'image', MAX_IMAGE_CALLS_PER_HOUR, 'Image request limit reached. Try again later.');
  const { word, query } = input;
  const deadline = Date.now() + IMAGE_SEARCH_DEADLINE_MS;
  let hadTransientProviderFailure = false;
  const fetchProvider = async (url: string, init: RequestInit = {}) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      hadTransientProviderFailure = true;
      return null;
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      Math.min(IMAGE_PROVIDER_TIMEOUT_MS, remaining),
    );
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (isImageProviderUnavailable(response)) hadTransientProviderFailure = true;
      return response;
    } catch {
      hadTransientProviderFailure = true;
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  };
  const parseProviderJson = async <T,>(response: Response): Promise<T | null> => {
    try {
      return await response.json() as T;
    } catch {
      hadTransientProviderFailure = true;
      return null;
    }
  };

  const pexelsResponse = await fetchProvider(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=8&orientation=landscape`, {
    headers: { Authorization: pexelsApiKey.value() },
  });
  if (pexelsResponse?.ok) {
    const data = await parseProviderJson<{ photos?: PexelsPhoto[] }>(pexelsResponse);
    const imageUrl = selectRelevantPexelsImage(Array.isArray(data?.photos) ? data.photos : [], query);
    if (imageUrl) return { imageUrl };
  }

  const unsplashResponse = await fetchProvider(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=8&orientation=landscape&client_id=${unsplashApiKey.value()}`);
  if (unsplashResponse?.ok) {
    const data = await parseProviderJson<{ results?: UnsplashPhoto[] }>(unsplashResponse);
    const imageUrl = selectRelevantUnsplashImage(Array.isArray(data?.results) ? data.results : [], query);
    if (imageUrl) return { imageUrl };
  }

  const wikipediaResponse = await fetchProvider(
    `https://en.wikipedia.org/w/api.php?action=query&prop=pageimages&format=json&piprop=thumbnail&pithumbsize=1200&titles=${encodeURIComponent(word)}&origin=*`,
  );
  if (wikipediaResponse?.ok) {
    const data = await parseProviderJson<{ query?: { pages?: Record<string, { thumbnail?: { source?: unknown } }> } }>(wikipediaResponse);
    const pages = data?.query?.pages;
    const firstPage = pages ? pages[Object.keys(pages)[0]] : undefined;
    if (isTrustedImageUrl(firstPage?.thumbnail?.source)) return { imageUrl: firstPage.thumbnail.source };
  }
  return { imageUrl: null, status: hadTransientProviderFailure ? 'transient' : 'no-result' };
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

  const now = Timestamp.now();
  const document = database.collection(SHARED_DECK_COLLECTION).doc();
  const ownership = database.collection(SHARED_DECK_OWNER_COLLECTION).doc(document.id);
  const expiresAt = Timestamp.fromMillis(now.toMillis() + SHARED_DECK_TTL_MS);
  const documents = buildSharedDeckDocuments(input, userId, now, expiresAt);
  await createSharedDeckAtomically(database, document, ownership, documents);
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

  const document = database.collection(SHARED_DECK_COLLECTION).doc(shareId);
  const ownership = database.collection(SHARED_DECK_OWNER_COLLECTION).doc(shareId);
  try {
    await revokeSharedDeckAtomically(database, document, ownership, userId);
  } catch (error) {
    if (error instanceof SharedDeckOwnershipError) {
      throw new HttpsError('permission-denied', error.message);
    }
    throw error;
  }
  return { revoked: true };
});

export const migrateLegacyLibrary = onCall({
  region: REGION,
  enforceAppCheck,
  timeoutSeconds: 120,
  memory: '512MiB',
  maxInstances: 1,
}, async request => {
  const userId = requireUser(request.auth);
  const input = parseOrInvalidArgument(() => parseLegacyLibraryMigrationRequest(request.data));
  await consumeBudget(
    userId,
    'legacy-library-migration',
    30,
    'Library migration request limit reached. Try again later.',
  );
  try {
    return await runLegacyLibraryMigration(legacyLibraryMigrationStore, userId, {
      jobId: 'query-v2',
      batchSize: input.batchSize,
      dryRun: input.dryRun,
    });
  } catch (error) {
    if (error instanceof LegacyLibraryInvalidCardsError) {
      throw new HttpsError(
        'failed-precondition',
        'A malformed legacy card needs administrator review before migration can continue.',
        { invalidCount: error.count },
      );
    }
    if (error instanceof LegacyLibraryGenerationChangedError) {
      throw new HttpsError('aborted', 'The library changed while it was upgrading. Retry the upgrade.');
    }
    console.error('Legacy library Admin migration failed.', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    throw new HttpsError('internal', 'The library upgrade could not finish.');
  }
});
