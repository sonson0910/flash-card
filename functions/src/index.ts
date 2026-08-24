import { GoogleGenAI, Type } from '@google/genai';
import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { defineBoolean, defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { createAiGenerationConfig } from './aiGeneration.js';
import {
  getVocabularyAiBudget,
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
  CardAllocationConflictError,
  CardAllocationLimitError,
  MAX_CARD_ALLOCATION,
  createCardForOwner,
  parseCreateCardRequest,
} from './cardPersistence.js';
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
  consumeRateLimitFailClosed,
  consumePersistentRateLimit,
  RateLimitExceededError,
  RATE_LIMIT_WINDOW_MS,
} from './rateLimiter.js';
import { consumeServiceBudget, withServiceBudget } from './serviceBudget.js';
import {
  buildSharedDeckDocuments,
  createSharedDeckAtomically,
  SharedDeckMigrationRequiredError,
  SharedDeckQuotaError,
  revokeSharedDeckAtomically,
  SHARED_DECK_COLLECTION,
  SHARED_DECK_OWNER_COLLECTION,
  SharedDeckOwnershipError,
  SharedDeckUsageStateError,
} from './sharedDeckPersistence.js';
import {
  applyReviewForOwner,
  parseReviewRequest,
  ReviewPersistenceConflictError,
} from './reviewPersistence.js';
import {
  applyGamificationForOwner,
  GamificationMigrationRequiredError,
  GamificationSequenceGapError,
  parseGamificationSaveRequest,
} from './gamificationPersistence.js';
import {
  applyLibraryFacetMutation,
  LibraryFacetOwnerMismatchError,
  parseLibraryFacetMutationRequest,
} from './libraryFacetPersistence.js';

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
const MAX_GEMINI_CALLS_PER_HOUR = 270;
const IMAGE_RATE_LIMIT_MESSAGE = 'Image request limit reached. Try again later.';
const IMAGE_SEARCH_DEADLINE_MS = 12_000;
const IMAGE_PROVIDER_TIMEOUT_MS = 4_000;
const MAX_SHARED_DECK_CREATIONS_PER_HOUR = 20;
const MAX_SHARED_DECK_REVOCATIONS_PER_HOUR = 120;
const SHARED_DECK_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const adminApp = getApps().length > 0 ? getApp() : initializeApp();
const database = getFirestore(adminApp, FIRESTORE_DATABASE_ID);
const legacyLibraryMigrationStore = createFirestoreLegacyLibraryMigrationStore(database);

const requireUser = (auth: { uid: string } | undefined) => {
  if (!auth?.uid) throw new HttpsError('unauthenticated', 'Sign in is required.');
  return auth.uid;
};

export const toGamificationHttpsError = (error: unknown): HttpsError | null => {
  if (error instanceof GamificationMigrationRequiredError) {
    return new HttpsError(
      'failed-precondition',
      'Gamification stream metadata requires protected migration.',
      { reason: error.reason },
    );
  }
  if (error instanceof GamificationSequenceGapError) {
    return new HttpsError(
      'failed-precondition',
      'Gamification XP sequence gap.',
      {
        reason: error.reason,
        clientId: error.clientId,
        expectedSequence: error.expectedSequence,
        receivedSequence: error.receivedSequence,
      },
    );
  }
  if (error instanceof InputValidationError) {
    return new HttpsError('invalid-argument', error.message);
  }
  return null;
};

export const toCardAllocationHttpsError = (error: unknown): HttpsError | null => {
  if (error instanceof CardAllocationLimitError) {
    return new HttpsError('resource-exhausted', error.message);
  }
  if (error instanceof CardAllocationConflictError) {
    return new HttpsError('failed-precondition', 'Card allocation precondition failed.', {
      reason: error.reason,
    });
  }
  return null;
};

export const toSharedDeckHttpsError = (error: unknown): HttpsError | null => {
  if (error instanceof SharedDeckQuotaError) {
    return new HttpsError('resource-exhausted', error.message);
  }
  if (error instanceof SharedDeckMigrationRequiredError || error instanceof SharedDeckUsageStateError) {
    return new HttpsError('failed-precondition', error.message);
  }
  return null;
};

export const saveGamification = onCall({
  region: REGION,
  enforceAppCheck,
}, async request => {
  const userId = requireUser(request.auth);
  const input = parseOrInvalidArgument(() => parseGamificationSaveRequest(request.data));
  try {
    return await applyGamificationForOwner(database, userId, input);
  } catch (error) {
    const mapped = toGamificationHttpsError(error);
    if (mapped) throw mapped;
    throw error;
  }
});

export const updateLibraryFacets = onCall({
  region: REGION,
  enforceAppCheck,
  timeoutSeconds: 15,
  memory: '256MiB',
  maxInstances: 5,
}, async request => {
  const userId = requireUser(request.auth);
  const input = parseOrInvalidArgument(() => parseLibraryFacetMutationRequest(request.data));
  if (input.ownerId !== userId) {
    throw new HttpsError('permission-denied', 'Library facet request owner does not match the authenticated owner.');
  }
  try {
    return await applyLibraryFacetMutation(database, userId, input);
  } catch (error) {
    if (error instanceof LibraryFacetOwnerMismatchError) {
      throw new HttpsError('permission-denied', error.message);
    }
    if (error instanceof InputValidationError) throw new HttpsError('invalid-argument', error.message);
    console.error('Library facet mutation failed.', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    throw new HttpsError('internal', 'Library facet mutation failed.');
  }
});

export const toRateLimitHttpsError = (error: unknown, message: string): HttpsError | null => {
  if (!(error instanceof RateLimitExceededError)) return null;
  const retryAfterMs = Number.isFinite(error.retryAfterMs)
    ? Math.max(0, error.retryAfterMs)
    : RATE_LIMIT_WINDOW_MS;
  const retryAfterSeconds = Math.min(
    Math.ceil(RATE_LIMIT_WINDOW_MS / 1_000),
    Math.max(1, Math.ceil(retryAfterMs / 1_000)),
  );
  return new HttpsError('resource-exhausted', message, { retryAfterSeconds });
};

const consumeCallableBudget = async (
  consume: () => Promise<unknown>,
  message: string,
): Promise<void> => {
  try {
    await consume();
  } catch (error) {
    const mapped = toRateLimitHttpsError(error, message);
    if (mapped) throw mapped;
    throw error;
  }
};

const consumeBudget = async (
  userId: string,
  scope: string,
  maximum: number,
  message: string,
  serviceScope?: string,
  serviceMaximum = maximum,
) => {
  await consumeCallableBudget(
    () => consumeRateLimitFailClosed(
      () => consumePersistentRateLimit(database, userId, scope, maximum),
    ),
    message,
  );
  if (serviceScope) {
    await consumeCallableBudget(
      () => consumeRateLimitFailClosed(
        () => consumeServiceBudget(database, serviceScope, serviceMaximum),
      ),
      message,
    );
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
  await consumeBudget(
    userId,
    budget.scope,
    budget.maximum,
    budget.message,
    'gemini',
    MAX_GEMINI_CALLS_PER_HOUR,
  );
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
  await consumeBudget(
    userId,
    'image',
    MAX_IMAGE_CALLS_PER_HOUR,
    IMAGE_RATE_LIMIT_MESSAGE,
  );
  const { word, query } = input;
  const deadline = Date.now() + IMAGE_SEARCH_DEADLINE_MS;
  let hadTransientProviderFailure = false;
  const consumeImageProviderBudget = () => consumeCallableBudget(
    () => consumeRateLimitFailClosed(
      () => consumeServiceBudget(database, 'image-provider', MAX_IMAGE_CALLS_PER_HOUR),
    ),
    IMAGE_RATE_LIMIT_MESSAGE,
  );
  const fetchProvider = async (url: string, init: RequestInit = {}, paid = false) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      hadTransientProviderFailure = true;
      return null;
    }
    const request = async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        Math.min(IMAGE_PROVIDER_TIMEOUT_MS, remaining),
      );
      try {
        return await fetch(url, { ...init, signal: controller.signal });
      } catch {
        hadTransientProviderFailure = true;
        return null;
      } finally {
        clearTimeout(timeoutId);
      }
    };
    const response = paid
      ? await withServiceBudget(consumeImageProviderBudget, request)
      : await request();
    if (response && isImageProviderUnavailable(response)) hadTransientProviderFailure = true;
    return response;
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
  }, true);
  if (pexelsResponse?.ok) {
    const data = await parseProviderJson<{ photos?: PexelsPhoto[] }>(pexelsResponse);
    const imageUrl = selectRelevantPexelsImage(Array.isArray(data?.photos) ? data.photos : [], query);
    if (imageUrl) return { imageUrl };
  }

  const unsplashResponse = await fetchProvider(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=8&orientation=landscape&client_id=${unsplashApiKey.value()}`, {}, true);
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

export const createCard = onCall({
  region: REGION,
  enforceAppCheck,
  timeoutSeconds: 15,
  memory: '256MiB',
  maxInstances: 5,
}, async request => {
  const userId = requireUser(request.auth);
  const input = parseOrInvalidArgument(() => parseCreateCardRequest(request.data));
  try {
    return await createCardForOwner(database, userId, input.card, {
      maximumCards: MAX_CARD_ALLOCATION,
      libraryEpoch: input.libraryEpoch,
      baseRevision: input.baseRevision,
      opId: input.opId,
      operationCreatedAt: input.operationCreatedAt,
    });
  } catch (error) {
    const allocationError = toCardAllocationHttpsError(error);
    if (allocationError) throw allocationError;
    if (error instanceof InputValidationError) {
      throw new HttpsError('invalid-argument', error.message);
    }
    console.error('Card allocation failed.', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    throw new HttpsError('internal', 'Card allocation failed.');
  }
});

export const reviewCard = onCall({
  region: REGION,
  enforceAppCheck,
  timeoutSeconds: 15,
  memory: '256MiB',
  maxInstances: 5,
}, async request => {
  const userId = requireUser(request.auth);
  const input = parseOrInvalidArgument(() => parseReviewRequest(request.data));
  try {
    return await applyReviewForOwner(database, userId, input);
  } catch (error) {
    if (error instanceof ReviewPersistenceConflictError) {
      throw new HttpsError('failed-precondition', 'The review precondition failed.', {
        reason: error.reason,
        ...(error.currentRevision === undefined ? {} : { currentRevision: error.currentRevision }),
        ...(error.card === undefined ? {} : { card: error.card }),
      });
    }
    if (error instanceof InputValidationError) throw new HttpsError('invalid-argument', error.message);
    console.error('Card review failed.', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    throw new HttpsError('internal', 'Card review failed.');
  }
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
  try {
    await createSharedDeckAtomically(database, document, ownership, documents, { now });
  } catch (error) {
    const mapped = toSharedDeckHttpsError(error);
    if (mapped) throw mapped;
    throw error;
  }
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
    const mapped = toSharedDeckHttpsError(error);
    if (mapped) throw mapped;
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
