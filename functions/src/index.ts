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
  LegacyLibrarySourceLimitError,
  MAX_BROWSER_LEGACY_LIBRARY_MIGRATION_SOURCE_CARDS,
  runLegacyLibraryMigration,
} from './legacyLibraryMigration.js';
import {
  createFirestoreLegacyLibraryMigrationStore,
  LegacyLibraryGenerationChangedError,
} from './legacyLibraryMigrationFirestore.js';
import { selectRelevantPexelsImage, type PexelsPhoto } from './imageSelection.js';
import {
  AnonymousAdmissionExceededError,
  consumePersistentRateLimit,
  createAnonymousAdmissionLimiter,
  createMemoryRateLimitStore,
  isFirestoreQuotaError,
  RateLimitExceededError,
} from './rateLimiter.js';
import {
  buildSharedDeckDocuments,
  createSharedDeckAtomically,
  loadPublicSharedDeck,
  revokeSharedDeckAtomically,
  SHARED_DECK_COLLECTION,
  SHARED_DECK_OWNER_COLLECTION,
  SharedDeckOwnershipError,
  SharedDeckUnavailableError,
} from './sharedDeckPersistence.js';
import { createReleaseProvenanceLabels } from './releaseProvenance.js';
import { classifyFunctionError, logFunctionEvent } from './structuredLogger.js';

const geminiApiKey = defineSecret('GEMINI_API_KEY');
const pexelsApiKey = defineSecret('PEXELS_API_KEY');
const enforceAppCheck = defineBoolean('ENFORCE_APP_CHECK', {
  default: true,
  description: 'Keep Firebase App Check enforced. Set false only for an explicitly isolated local emulator.',
});
const MODEL = 'gemini-3.1-flash-lite';
const REGION = 'asia-southeast1';
const releaseProvenanceLabels = createReleaseProvenanceLabels(
  process.env.SONFLASH_RELEASE_REVISION,
  process.env.SONFLASH_RELEASE_CANDIDATE_SHA256,
);
const FIRESTORE_DATABASE_ID = runtimeTarget.firestoreDatabaseId;
const MAX_IMAGE_CALLS_PER_HOUR = 120;
const MAX_SHARED_DECK_CREATIONS_PER_HOUR = 20;
const MAX_SHARED_DECK_REVOCATIONS_PER_HOUR = 120;
const SHARED_DECK_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const adminApp = getApps().length > 0 ? getApp() : initializeApp();
const database = getFirestore(adminApp, FIRESTORE_DATABASE_ID);
const legacyLibraryMigrationStore = createFirestoreLegacyLibraryMigrationStore(database);
const memoryRateLimit = createMemoryRateLimitStore();
const sharedDeckLoadAdmission = createAnonymousAdmissionLimiter();
let memoryRateLimitFallbackReported = false;

const requireUser = (auth: { uid: string } | undefined) => {
  if (!auth?.uid) throw new HttpsError('unauthenticated', 'Sign in is required.');
  return auth.uid;
};

const consumeBudget = async (userId: string, scope: string, maximum: number, message: string) => {
  try {
    await consumePersistentRateLimit(database, userId, scope, maximum);
  } catch (error) {
    let failure = error;
    if (isVocabularyAiRateLimitScope(scope) && isFirestoreQuotaError(error)) {
      if (!memoryRateLimitFallbackReported) {
        memoryRateLimitFallbackReported = true;
        logFunctionEvent({
          event: 'rate-limit-storage-fallback',
          outcome: 'activated',
          reason: 'firestore-quota',
          limit: maximum,
        });
      }
      try {
        memoryRateLimit.consume(userId, scope, maximum);
        return;
      } catch (fallbackError) {
        failure = fallbackError;
      }
    }
    if (failure instanceof RateLimitExceededError) {
      throw new HttpsError('resource-exhausted', message, {
        retryAfterSeconds: Math.ceil(failure.retryAfterMs / 1_000),
      });
    }
    throw failure;
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
  labels: releaseProvenanceLabels,
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
    return url.protocol === 'https:' && ['images.pexels.com', 'upload.wikimedia.org'].includes(url.hostname);
  } catch {
    return false;
  }
};

export const findVocabularyImage = onCall({
  region: REGION,
  labels: releaseProvenanceLabels,
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
  labels: releaseProvenanceLabels,
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

export const loadSharedDeck = onCall({
  region: REGION,
  labels: releaseProvenanceLabels,
  enforceAppCheck,
  timeoutSeconds: 10,
  memory: '256MiB',
  maxInstances: 10,
}, async request => {
  try {
    sharedDeckLoadAdmission.consume(request.rawRequest.ip);
  } catch (error) {
    if (error instanceof AnonymousAdmissionExceededError) {
      throw new HttpsError(
        'resource-exhausted',
        'Shared-deck load limit reached. Try again later.',
        { retryAfterSeconds: Math.ceil(error.retryAfterMs / 1_000) },
      );
    }
    throw error;
  }

  const { shareId } = parseOrInvalidArgument(() => parseRevokeSharedDeckRequest(request.data));
  try {
    return await loadPublicSharedDeck(
      database.collection(SHARED_DECK_COLLECTION).doc(shareId),
    );
  } catch (error) {
    if (error instanceof SharedDeckUnavailableError) {
      throw new HttpsError('not-found', error.message);
    }
    throw error;
  }
});

export const revokeSharedDeck = onCall({
  region: REGION,
  labels: releaseProvenanceLabels,
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
  labels: releaseProvenanceLabels,
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
    if (error instanceof LegacyLibrarySourceLimitError) {
      const isBrowserSourceLimit = (
        error.maximumSourceCards === MAX_BROWSER_LEGACY_LIBRARY_MIGRATION_SOURCE_CARDS
      );
      throw new HttpsError(
        'failed-precondition',
        isBrowserSourceLimit
          ? 'This browser upgrade supports libraries of up to 3,000 cards. Ask an administrator to run the protected operator migration.'
          : 'The library exceeds the migration size limit and needs administrator review.',
        isBrowserSourceLimit ? {
          reason: 'browser-source-card-limit',
          maximumSourceCards: error.maximumSourceCards,
        } : undefined,
      );
    }
    logFunctionEvent({
      event: 'legacy-library-migration',
      outcome: 'failed',
      reason: 'unexpected-error',
      errorClass: classifyFunctionError(error),
    });
    throw new HttpsError('internal', 'The library upgrade could not finish.');
  }
});
