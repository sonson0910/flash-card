const MAXIMUM_AUDIO_BYTES = 1_048_576;

export const PRONUNCIATION_ASSESSMENT_LIMITS = Object.freeze({
  maximumAudioBytes: MAXIMUM_AUDIO_BYTES,
  maximumAudioBase64Length: 4 * Math.ceil(MAXIMUM_AUDIO_BYTES / 3),
  maximumAudioDurationMs: 30_000,
  maximumReferenceTextLength: 500,
  maximumActivityIdLength: 128,
  maximumAlternatives: 5,
  maximumWords: 200,
  maximumPhonemesPerWord: 64,
  defaultTimeoutMs: 10_000,
  defaultCircuitFailureLimit: 3,
  defaultCircuitCooldownMs: 60_000,
} as const);

export type PronunciationAudioMimeType = 'audio/wav';
export type PronunciationAudioCodec = 'pcm_s16le';

export interface PronunciationAssessmentAudio {
  readonly mimeType: PronunciationAudioMimeType;
  readonly codec: PronunciationAudioCodec;
  readonly sampleRateHz: number | null;
  readonly channels: number | null;
  readonly durationMs: number;
  readonly byteLength: number;
  readonly base64: string;
}

export interface PronunciationAssessmentRequest {
  readonly locale: 'en-US';
  readonly activityId: string;
  readonly referenceText: string;
  readonly audio: PronunciationAssessmentAudio;
}

export interface PronunciationAssessmentPhonemeResult {
  readonly symbol: string | null;
  readonly accuracy: number | null;
}

export interface PronunciationAssessmentWordResult {
  readonly word: string | null;
  readonly accuracy: number | null;
  readonly fluency: number | null;
  readonly completeness: number | null;
  readonly phonemes: readonly PronunciationAssessmentPhonemeResult[] | null;
}

export interface PronunciationAssessmentResult {
  readonly provider: 'azure-speech';
  readonly status: 'success';
  readonly locale: 'en-US';
  readonly activityId: string;
  readonly accuracy: number | null;
  readonly fluency: number | null;
  readonly completeness: number | null;
  readonly prosody: number | null;
  readonly words: readonly PronunciationAssessmentWordResult[] | null;
}

type UnknownRecord = Record<string, unknown>;
type FetchImplementation = (input: string, init?: RequestInit) => Promise<Response>;

const fail = (path: string, message: string): never => {
  throw new PronunciationAssessmentValidationError(`${path}: ${message}`);
};

const recordAt = (value: unknown, path: string, keys?: readonly string[]): UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, 'expected object');
  }
  const record = value as UnknownRecord;
  if (keys) {
    const unknown = Object.keys(record).find(key => !keys.includes(key));
    if (unknown) fail(`${path}.${unknown}`, 'unknown field');
  }
  return record;
};

const requiredString = (value: unknown, path: string, maximum: number): string => {
  if (typeof value !== 'string') fail(path, 'expected string');
  const parsed = (value as string).normalize('NFKC').trim();
  if (!parsed || parsed.length > maximum) fail(path, `expected 1-${maximum} characters`);
  if (/[\u0000-\u001F\u007F]/.test(parsed)) fail(path, 'must not contain control characters');
  return parsed;
};

const boundedInteger = (value: unknown, path: string, maximum: number): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    fail(path, `expected an integer between 1 and ${maximum}`);
  }
  return value as number;
};

const optionalInteger = (value: unknown, path: string, expected: number | null): number | null => {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || value !== expected) fail(path, `expected ${expected} or null`);
  return value as number;
};

const decodeBase64 = (value: unknown, path: string): Buffer => {
  if (typeof value !== 'string' || value.length === 0) {
    fail(path, 'expected canonical base64');
  }
  const encoded = value as string;
  if (encoded.length > PRONUNCIATION_ASSESSMENT_LIMITS.maximumAudioBase64Length) {
    fail(path, 'encoded audio exceeds the maximum base64 length');
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    fail(path, 'expected canonical base64');
  }
  const decoded = Buffer.from(encoded, 'base64');
  if (decoded.length === 0 || decoded.toString('base64') !== encoded) {
    fail(path, 'expected canonical base64');
  }
  return decoded;
};

export class PronunciationAssessmentValidationError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = 'PronunciationAssessmentValidationError';
  }
}

export class PronunciationAssessmentUnavailableError extends Error {
  constructor(message = 'Pronunciation assessment is unavailable in this deployment.') {
    super(message);
    this.name = 'PronunciationAssessmentUnavailableError';
  }
}

export class PronunciationAssessmentTimeoutError extends Error {
  constructor(message = 'Pronunciation assessment provider timed out.') {
    super(message);
    this.name = 'PronunciationAssessmentTimeoutError';
  }
}

export class PronunciationAssessmentProviderError extends Error {
  constructor(message = 'Pronunciation assessment provider returned an unusable response.') {
    super(message);
    this.name = 'PronunciationAssessmentProviderError';
  }
}

export class PronunciationAssessmentCircuitOpenError extends Error {
  constructor(message = 'Pronunciation assessment is temporarily unavailable.') {
    super(message);
    this.name = 'PronunciationAssessmentCircuitOpenError';
  }
}

const validateWavPcm = (bytes: Buffer, path: string): number => {
  if (bytes.length < 46
    || bytes.toString('ascii', 0, 4) !== 'RIFF'
    || bytes.toString('ascii', 8, 12) !== 'WAVE'
    || bytes.readUInt32LE(4) !== bytes.length - 8) {
    fail(path, 'expected a bounded RIFF/WAVE container');
  }

  let offset = 12;
  let formatFound = false;
  let dataFound = false;
  let dataLength = 0;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) fail(path, 'WAV chunk header is truncated');
    const chunkId = bytes.toString('ascii', offset, offset + 4);
    const chunkLength = bytes.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;
    const paddedEnd = chunkEnd + (chunkLength % 2);
    if (chunkEnd > bytes.length || paddedEnd > bytes.length) {
      fail(path, 'WAV chunk is truncated');
    }

    if (chunkId === 'fmt ') {
      if (formatFound || chunkLength < 16) fail(path, 'WAV PCM format chunk is invalid');
      const audioFormat = bytes.readUInt16LE(chunkStart);
      const channels = bytes.readUInt16LE(chunkStart + 2);
      const sampleRate = bytes.readUInt32LE(chunkStart + 4);
      const byteRate = bytes.readUInt32LE(chunkStart + 8);
      const blockAlign = bytes.readUInt16LE(chunkStart + 12);
      const bitsPerSample = bytes.readUInt16LE(chunkStart + 14);
      if (audioFormat !== 1 || channels !== 1 || sampleRate !== 16_000
        || byteRate !== 32_000 || blockAlign !== 2 || bitsPerSample !== 16) {
        fail(path, 'WAV must be PCM 16 kHz mono 16-bit audio');
      }
      formatFound = true;
    } else if (chunkId === 'data') {
      if (dataFound || chunkLength < 2 || chunkLength % 2 !== 0
        || chunkLength > (32_000 * PRONUNCIATION_ASSESSMENT_LIMITS.maximumAudioDurationMs) / 1_000) {
        fail(path, 'WAV data chunk is invalid or exceeds the duration bound');
      }
      dataFound = true;
      dataLength = chunkLength;
    }
    offset = paddedEnd;
  }

  if (offset !== bytes.length || !formatFound || !dataFound) {
    fail(path, 'WAV must contain one valid fmt and data chunk');
  }
  return Math.ceil((dataLength * 1_000) / 32_000);
};

export function parsePronunciationAssessmentRequest(value: unknown): PronunciationAssessmentRequest {
  const record = recordAt(value, 'pronunciationAssessment', ['locale', 'activityId', 'referenceText', 'audio']);
  if (record.locale !== 'en-US') fail('pronunciationAssessment.locale', 'only en-US is supported');
  const audio = recordAt(record.audio, 'pronunciationAssessment.audio', [
    'mimeType', 'codec', 'sampleRateHz', 'channels', 'durationMs', 'byteLength', 'base64',
  ]);
  const mimeType = audio.mimeType;
  const codec = audio.codec;
  if (mimeType !== 'audio/wav') {
    fail('pronunciationAssessment.audio.mimeType', 'unsupported audio MIME type');
  }
  if (codec !== 'pcm_s16le') {
    fail('pronunciationAssessment.audio.codec', 'PCM WAV requires pcm_s16le');
  }
  const sampleRateHz = optionalInteger(audio.sampleRateHz, 'pronunciationAssessment.audio.sampleRateHz', 16_000);
  const channels = optionalInteger(audio.channels, 'pronunciationAssessment.audio.channels', 1);
  if (sampleRateHz !== 16_000 || channels !== 1) {
    fail('pronunciationAssessment.audio', 'PCM WAV must be 16 kHz mono');
  }
  const durationMs = boundedInteger(
    audio.durationMs,
    'pronunciationAssessment.audio.durationMs',
    PRONUNCIATION_ASSESSMENT_LIMITS.maximumAudioDurationMs,
  );
  const declaredByteLength = boundedInteger(
    audio.byteLength,
    'pronunciationAssessment.audio.byteLength',
    PRONUNCIATION_ASSESSMENT_LIMITS.maximumAudioBytes,
  );
  const bytes = decodeBase64(audio.base64, 'pronunciationAssessment.audio.base64');
  if (bytes.byteLength !== declaredByteLength) {
    fail('pronunciationAssessment.audio.byteLength', 'does not match decoded audio');
  }
  const actualDurationMs = validateWavPcm(bytes, 'pronunciationAssessment.audio');
  if (durationMs !== actualDurationMs) {
    fail('pronunciationAssessment.audio.durationMs', 'must equal WAV data duration rounded up to whole milliseconds');
  }
  const activityId = requiredString(
    record.activityId,
    'pronunciationAssessment.activityId',
    PRONUNCIATION_ASSESSMENT_LIMITS.maximumActivityIdLength,
  );
  if (activityId.includes('/')) fail('pronunciationAssessment.activityId', 'must not contain slash');

  return {
    locale: 'en-US',
    activityId,
    referenceText: requiredString(
      record.referenceText,
      'pronunciationAssessment.referenceText',
      PRONUNCIATION_ASSESSMENT_LIMITS.maximumReferenceTextLength,
    ),
    audio: {
      mimeType: mimeType as PronunciationAudioMimeType,
      codec: codec as PronunciationAudioCodec,
      sampleRateHz,
      channels,
      durationMs,
      byteLength: declaredByteLength,
      base64: audio.base64 as string,
    },
  };
}

const optionalScore = (value: unknown, path: string): number | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new PronunciationAssessmentProviderError(`${path}: invalid score`);
  }
  return value;
};

const optionalText = (value: unknown, path: string, maximum: number): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new PronunciationAssessmentProviderError(`${path}: invalid text`);
  const parsed = value.normalize('NFKC').trim();
  if (!parsed) return null;
  if (parsed.length > maximum || /[\u0000-\u001F\u007F]/.test(parsed)) {
    throw new PronunciationAssessmentProviderError(`${path}: invalid text`);
  }
  return parsed;
};

const scoreFrom = (record: UnknownRecord, assessment: UnknownRecord | null, key: string, path: string): number | null => (
  optionalScore(record[key] !== undefined ? record[key] : assessment?.[key], path)
);

const assessmentAt = (record: UnknownRecord, path: string): UnknownRecord | null => {
  if (record.PronunciationAssessment === undefined || record.PronunciationAssessment === null) return null;
  return recordAt(record.PronunciationAssessment, path);
};

const parsePhonemes = (value: unknown, path: string): readonly PronunciationAssessmentPhonemeResult[] | null => {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length > PRONUNCIATION_ASSESSMENT_LIMITS.maximumPhonemesPerWord) {
    throw new PronunciationAssessmentProviderError(`${path}: invalid phoneme list`);
  }
  return value.map((item, index) => {
    const record = recordAt(item, `${path}[${index}]`);
    const assessment = assessmentAt(record, `${path}[${index}].PronunciationAssessment`);
    return {
      symbol: optionalText(record.Phoneme, `${path}[${index}].Phoneme`, 32),
      accuracy: scoreFrom(record, assessment, 'AccuracyScore', `${path}[${index}].AccuracyScore`),
    };
  });
};

const parseWords = (value: unknown): readonly PronunciationAssessmentWordResult[] | null => {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length > PRONUNCIATION_ASSESSMENT_LIMITS.maximumWords) {
    throw new PronunciationAssessmentProviderError('Azure response contained too many words.');
  }
  return value.map((item, index) => {
    const record = recordAt(item, `Words[${index}]`);
    const assessment = assessmentAt(record, `Words[${index}].PronunciationAssessment`);
    return {
      word: optionalText(record.Word, `Words[${index}].Word`, 128),
      accuracy: scoreFrom(record, assessment, 'AccuracyScore', `Words[${index}].AccuracyScore`),
      fluency: scoreFrom(record, assessment, 'FluencyScore', `Words[${index}].FluencyScore`),
      completeness: scoreFrom(record, assessment, 'CompletenessScore', `Words[${index}].CompletenessScore`),
      phonemes: parsePhonemes(record.Phonemes, `Words[${index}].Phonemes`),
    };
  });
};

export function parseAzurePronunciationResponse(
  value: unknown,
  request: PronunciationAssessmentRequest,
): PronunciationAssessmentResult {
  const record = recordAt(value, 'azurePronunciationResponse');
  if (record.RecognitionStatus !== 'Success') {
    throw new PronunciationAssessmentProviderError('Azure did not return a successful recognition result.');
  }
  if (!Array.isArray(record.NBest)
    || record.NBest.length === 0
    || record.NBest.length > PRONUNCIATION_ASSESSMENT_LIMITS.maximumAlternatives) {
    throw new PronunciationAssessmentProviderError('Azure returned no pronunciation result.');
  }
  const best = recordAt(record.NBest[0], 'azurePronunciationResponse.NBest[0]');
  const assessment = assessmentAt(best, 'azurePronunciationResponse.NBest[0].PronunciationAssessment');
  return {
    provider: 'azure-speech',
    status: 'success',
    locale: request.locale,
    activityId: request.activityId,
    accuracy: scoreFrom(best, assessment, 'AccuracyScore', 'AccuracyScore'),
    fluency: scoreFrom(best, assessment, 'FluencyScore', 'FluencyScore'),
    completeness: scoreFrom(best, assessment, 'CompletenessScore', 'CompletenessScore'),
    prosody: scoreFrom(best, assessment, 'ProsodyScore', 'ProsodyScore'),
    words: parseWords(best.Words),
  };
}

export interface PronunciationAssessmentProvider {
  readonly available: boolean;
  assess(request: PronunciationAssessmentRequest): Promise<PronunciationAssessmentResult>;
}

export interface AzurePronunciationAssessmentProviderOptions {
  readonly apiKey?: string | null;
  readonly region?: string | null;
  readonly fetchImpl?: FetchImplementation;
  readonly timeoutMs?: number;
}

const unavailableProvider = (): PronunciationAssessmentProvider => ({
  available: false,
  assess: async () => { throw new PronunciationAssessmentUnavailableError(); },
});

const AZURE_WAV_CONTENT_TYPE = 'audio/wav; codecs=audio/pcm; samplerate=16000';

export function createAzurePronunciationAssessmentProvider({
  apiKey,
  region,
  fetchImpl = globalThis.fetch?.bind(globalThis) as FetchImplementation | undefined,
  timeoutMs = PRONUNCIATION_ASSESSMENT_LIMITS.defaultTimeoutMs,
}: AzurePronunciationAssessmentProviderOptions): PronunciationAssessmentProvider {
  const safeKey = typeof apiKey === 'string' ? apiKey.trim() : '';
  const safeRegion = typeof region === 'string' ? region.trim().toLowerCase() : '';
  if (!safeKey || safeKey.length > 512 || !/^[a-z0-9-]{1,64}$/.test(safeRegion) || !fetchImpl) {
    return unavailableProvider();
  }
  const safeTimeoutMs = Number.isSafeInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : PRONUNCIATION_ASSESSMENT_LIMITS.defaultTimeoutMs;

  return {
    available: true,
    async assess(request) {
      const parsed = parsePronunciationAssessmentRequest(request);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), safeTimeoutMs);
      const assessmentHeader = Buffer.from(JSON.stringify({
        ReferenceText: parsed.referenceText,
        GradingSystem: 'HundredMark',
        Granularity: 'Phoneme',
        Dimension: 'Comprehensive',
        EnableProsodyAssessment: 'True',
      }), 'utf8').toString('base64');
      try {
        const response = await fetchImpl(
          `https://${safeRegion}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${encodeURIComponent(parsed.locale)}&format=detailed`,
          {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': AZURE_WAV_CONTENT_TYPE,
              'Ocp-Apim-Subscription-Key': safeKey,
              'Pronunciation-Assessment': assessmentHeader,
            },
            body: Buffer.from(parsed.audio.base64, 'base64'),
            signal: controller.signal,
          },
        );
        if (!response.ok) throw new PronunciationAssessmentProviderError();
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          throw new PronunciationAssessmentProviderError();
        }
        return parseAzurePronunciationResponse(payload, parsed);
      } catch (error) {
        if (error instanceof PronunciationAssessmentProviderError) throw error;
        if (error instanceof Error && error.name === 'AbortError') {
          throw new PronunciationAssessmentTimeoutError();
        }
        throw new PronunciationAssessmentProviderError();
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

export interface PronunciationAssessmentEnvironment {
  readonly ENABLE_PRONUNCIATION_ASSESSMENT?: string;
  readonly AZURE_SPEECH_KEY?: string;
  readonly AZURE_SPEECH_REGION?: string;
}

export function createPronunciationAssessmentProviderFromEnvironment(
  environment: PronunciationAssessmentEnvironment = process.env,
  options: Pick<AzurePronunciationAssessmentProviderOptions, 'fetchImpl' | 'timeoutMs'> = {},
): PronunciationAssessmentProvider {
  if (environment.ENABLE_PRONUNCIATION_ASSESSMENT !== 'true') return unavailableProvider();
  return createAzurePronunciationAssessmentProvider({
    apiKey: environment.AZURE_SPEECH_KEY,
    region: environment.AZURE_SPEECH_REGION,
    ...options,
  });
}

export interface PronunciationAssessmentCircuitOptions {
  readonly failureLimit?: number;
  readonly cooldownMs?: number;
  readonly now?: () => number;
}

export function createPronunciationAssessmentCircuit(
  provider: PronunciationAssessmentProvider,
  {
    failureLimit = PRONUNCIATION_ASSESSMENT_LIMITS.defaultCircuitFailureLimit,
    cooldownMs = PRONUNCIATION_ASSESSMENT_LIMITS.defaultCircuitCooldownMs,
    now = Date.now,
  }: PronunciationAssessmentCircuitOptions = {},
): PronunciationAssessmentProvider {
  const safeFailureLimit = Number.isSafeInteger(failureLimit) && failureLimit > 0 ? failureLimit : 3;
  const safeCooldownMs = Number.isSafeInteger(cooldownMs) && cooldownMs > 0 ? cooldownMs : 60_000;
  let failures = 0;
  let openUntil = 0;

  return {
    available: provider.available,
    async assess(request) {
      if (!provider.available) throw new PronunciationAssessmentUnavailableError();
      if (now() < openUntil) throw new PronunciationAssessmentCircuitOpenError();
      try {
        const result = await provider.assess(request);
        failures = 0;
        openUntil = 0;
        return result;
      } catch (error) {
        if (error instanceof PronunciationAssessmentUnavailableError) throw error;
        failures += 1;
        if (failures >= safeFailureLimit) openUntil = now() + safeCooldownMs;
        throw error;
      }
    },
  };
}
