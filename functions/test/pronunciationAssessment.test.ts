import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  PRONUNCIATION_ASSESSMENT_LIMITS,
  createAzurePronunciationAssessmentProvider,
  createPronunciationAssessmentCircuit,
  createPronunciationAssessmentProviderFromEnvironment,
  parseAzurePronunciationResponse,
  parsePronunciationAssessmentRequest,
  PronunciationAssessmentCircuitOpenError,
  PronunciationAssessmentProviderError,
  PronunciationAssessmentTimeoutError,
  PronunciationAssessmentUnavailableError,
  type PronunciationAssessmentRequest,
  type PronunciationAssessmentResult,
} from '../src/pronunciationAssessment.js';
import { toPronunciationAssessmentHttpsError } from '../src/index.js';

const makeWavBytes = () => {
  const bytes = Buffer.alloc(46);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVE', 8, 'ascii');
  bytes.write('fmt ', 12, 'ascii');
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16_000, 24);
  bytes.writeUInt32LE(32_000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36, 'ascii');
  bytes.writeUInt32LE(2, 40);
  bytes.writeInt16LE(0, 42);
  return bytes;
};

const wavBytes = makeWavBytes();
const validRequest = (overrides: Record<string, unknown> = {}) => ({
  locale: 'en-US',
  activityId: 'shadow-1',
  referenceText: 'Hello from the practice room.',
  audio: {
    mimeType: 'audio/wav',
    codec: 'pcm_s16le',
    sampleRateHz: 16_000,
    channels: 1,
    durationMs: 1,
    byteLength: wavBytes.byteLength,
    base64: wavBytes.toString('base64'),
  },
  ...overrides,
});

const validParsedRequest = (): PronunciationAssessmentRequest => (
  parsePronunciationAssessmentRequest(validRequest())
);

const successfulResponse = (): Record<string, unknown> => ({
  RecognitionStatus: 'Success',
  NBest: [{
    PronunciationAssessment: {
      AccuracyScore: 88,
      CompletenessScore: 75,
      FluencyScore: null,
    },
    Words: [{
      Word: 'hello',
      PronunciationAssessment: { AccuracyScore: 88 },
      Phonemes: [{ Phoneme: 'h', PronunciationAssessment: { AccuracyScore: 91 } }],
    }],
  }],
});

describe('pronunciation assessment request parser', () => {
  it('accepts only the bounded en-US PCM WAV contract', () => {
    expect(parsePronunciationAssessmentRequest(validRequest())).toMatchObject({
      locale: 'en-US',
      activityId: 'shadow-1',
      referenceText: 'Hello from the practice room.',
      audio: {
        mimeType: 'audio/wav',
        codec: 'pcm_s16le',
        sampleRateHz: 16_000,
        channels: 1,
      },
    });
  });

  it('rejects wrong MIME/codec, arbitrary URLs, malformed base64, and mismatched bytes', () => {
    expect(() => parsePronunciationAssessmentRequest(validRequest({
      audio: { ...validRequest().audio, mimeType: 'audio/webm' },
    }))).toThrow(/MIME|format|audio/i);
    expect(() => parsePronunciationAssessmentRequest(validRequest({
      audio: { ...validRequest().audio, codec: 'opus' },
    }))).toThrow(/PCM|codec|audio/i);
    expect(() => parsePronunciationAssessmentRequest(validRequest({
      audio: { ...validRequest().audio, url: 'https://example.test/audio.wav' },
    }))).toThrow(/unknown|URL|audio/i);
    expect(() => parsePronunciationAssessmentRequest(validRequest({
      audio: { ...validRequest().audio, base64: 'not base64!' },
    }))).toThrow(/base64/i);
    expect(() => parsePronunciationAssessmentRequest(validRequest({
      audio: { ...validRequest().audio, byteLength: wavBytes.byteLength + 1 },
    }))).toThrow(/byte/i);
  });

  it('rejects oversized reference/audio duration/bytes and non-canonical request fields', () => {
    expect(() => parsePronunciationAssessmentRequest(validRequest({
      referenceText: 'x'.repeat(PRONUNCIATION_ASSESSMENT_LIMITS.maximumReferenceTextLength + 1),
    }))).toThrow(/reference/i);
    expect(() => parsePronunciationAssessmentRequest(validRequest({
      audio: {
        ...validRequest().audio,
        durationMs: PRONUNCIATION_ASSESSMENT_LIMITS.maximumAudioDurationMs + 1,
      },
    }))).toThrow(/duration/i);
    const oversized = Buffer.alloc(PRONUNCIATION_ASSESSMENT_LIMITS.maximumAudioBytes + 1);
    expect(() => parsePronunciationAssessmentRequest(validRequest({
      audio: {
        ...validRequest().audio,
        byteLength: oversized.byteLength,
        base64: oversized.toString('base64'),
      },
    }))).toThrow(/bytes|audio/i);
    expect(() => parsePronunciationAssessmentRequest({ ...validRequest(), ownerId: 'attacker' }))
      .toThrow(/unknown|owner/i);
    expect(() => parsePronunciationAssessmentRequest({ ...validRequest(), locale: 'vi-VN' }))
      .toThrow(/locale/i);
    expect(() => parsePronunciationAssessmentRequest({ ...validRequest(), activityId: 'activity/1' }))
      .toThrow(/activityId/i);
  });

  it('rejects encoded audio before decoding when the declared byte count is small', () => {
    const maximumEncodedLength = 4 * Math.ceil(PRONUNCIATION_ASSESSMENT_LIMITS.maximumAudioBytes / 3);
    const encodedOversizedAudio = 'A'.repeat(maximumEncodedLength + 4);
    expect(() => parsePronunciationAssessmentRequest(validRequest({
      audio: {
        ...validRequest().audio,
        byteLength: 1,
        base64: encodedOversizedAudio,
      },
    }))).toThrow(/base64|encoded|size/i);
  });

  it('rejects labeled audio whose bytes are not a supported WAV container', () => {
    const fakeWav = Buffer.from('pcm-audio');
    expect(() => parsePronunciationAssessmentRequest(validRequest({
      audio: { ...validRequest().audio, byteLength: fakeWav.length, base64: fakeWav.toString('base64') },
    }))).toThrow(/RIFF|WAV/i);

    const mismatchedWav = Buffer.from(wavBytes);
    mismatchedWav.writeUInt32LE(8_000, 24);
    expect(() => parsePronunciationAssessmentRequest(validRequest({
      audio: { ...validRequest().audio, byteLength: mismatchedWav.length, base64: mismatchedWav.toString('base64') },
    }))).toThrow(/sample|16|WAV/i);
  });

  it('rejects a declared duration that does not equal the bounded WAV data duration', () => {
    expect(() => parsePronunciationAssessmentRequest(validRequest({
      audio: { ...validRequest().audio, durationMs: 2 },
    }))).toThrow(/duration/i);
  });
});

describe('Azure pronunciation response parser', () => {
  it('keeps missing overall, word, and phoneme metrics null without inferring scores', () => {
    const result = parseAzurePronunciationResponse(
      successfulResponse(),
      validParsedRequest(),
    );

    expect(result).toEqual({
      provider: 'azure-speech',
      status: 'success',
      locale: 'en-US',
      activityId: 'shadow-1',
      accuracy: 88,
      fluency: null,
      completeness: 75,
      prosody: null,
      words: [{
        word: 'hello',
        accuracy: 88,
        fluency: null,
        completeness: null,
        phonemes: [{ symbol: 'h', accuracy: 91 }],
      }],
    });
  });

  it('parses the official detailed REST response shape with scores on NBest and Words', () => {
    const result = parseAzurePronunciationResponse({
      RecognitionStatus: 'Success',
      NBest: [{
        AccuracyScore: 88,
        FluencyScore: 70,
        CompletenessScore: 75,
        ProsodyScore: 66,
        Words: [{
          Word: 'hello',
          AccuracyScore: 91,
          Phonemes: [{ Phoneme: 'h', AccuracyScore: 95 }],
        }],
      }],
    }, validParsedRequest());

    expect(result).toMatchObject({
      accuracy: 88,
      fluency: 70,
      completeness: 75,
      prosody: 66,
      words: [{
        word: 'hello',
        accuracy: 91,
        phonemes: [{ symbol: 'h', accuracy: 95 }],
      }],
    });
  });

  it('rejects non-success or out-of-range provider responses without producing a pass/fail label', () => {
    expect(() => parseAzurePronunciationResponse(
      { RecognitionStatus: 'NoMatch', NBest: [] },
      validParsedRequest(),
    )).toThrow(/result|match|provider/i);
    expect(() => parseAzurePronunciationResponse({
      ...successfulResponse(),
      NBest: [{ PronunciationAssessment: { AccuracyScore: 101 } }],
    }, validParsedRequest())).toThrow(/score/i);
    expect(JSON.stringify(successfulResponse())).not.toMatch(/native-like|pass|fail/i);
  });

  it('rejects an unbounded alternative list instead of silently selecting one', () => {
    expect(() => parseAzurePronunciationResponse({
      ...successfulResponse(),
      NBest: Array.from(
        { length: PRONUNCIATION_ASSESSMENT_LIMITS.maximumAlternatives + 1 },
        () => successfulResponse().NBest,
      ).flat(),
    }, validParsedRequest())).toThrow(/alternative|result/i);
  });
});

describe('Azure pronunciation provider adapter', () => {
  it('sends bounded audio server-side with the base64 assessment header and exact content type', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      const decodedHeader = JSON.parse(Buffer.from(headers['Pronunciation-Assessment'], 'base64').toString('utf8'));
      expect(decodedHeader).toEqual({
        ReferenceText: 'Hello from the practice room.',
        GradingSystem: 'HundredMark',
        Granularity: 'Phoneme',
        Dimension: 'Comprehensive',
        EnableProsodyAssessment: 'True',
      });
      expect(headers['Content-Type']).toBe('audio/wav; codecs=audio/pcm; samplerate=16000');
      expect(headers['Ocp-Apim-Subscription-Key']).toBe('server-only-key');
      expect(init?.body).toEqual(wavBytes);
      return { ok: true, json: async () => successfulResponse() } as Response;
    });
    const provider = createAzurePronunciationAssessmentProvider({
      apiKey: 'server-only-key',
      region: 'eastus',
      fetchImpl,
    });

    await expect(provider.assess(validParsedRequest())).resolves.toMatchObject({
      provider: 'azure-speech', status: 'success', accuracy: 88,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('normalizes malformed nested provider results as unavailable provider errors', async () => {
    const provider = createAzurePronunciationAssessmentProvider({
      apiKey: 'server-only-key',
      region: 'eastus',
      fetchImpl: vi.fn(async () => ({
        ok: true,
        json: async () => ({ RecognitionStatus: 'Success', NBest: [{ PronunciationAssessment: [] }] }),
      }) as Response),
    });

    const error = await provider.assess(validParsedRequest()).catch(reason => reason);
    expect(error).toBeInstanceOf(PronunciationAssessmentProviderError);
    expect(toPronunciationAssessmentHttpsError(error)?.code).toBe('unavailable');
  });

  it('fails closed without key/region and never calls the provider', async () => {
    const fetchImpl = vi.fn();
    const provider = createAzurePronunciationAssessmentProvider({
      apiKey: '',
      region: null,
      fetchImpl,
    });

    expect(provider.available).toBe(false);
    await expect(provider.assess(validParsedRequest())).rejects.toBeInstanceOf(PronunciationAssessmentUnavailableError);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(createPronunciationAssessmentProviderFromEnvironment({}).available).toBe(false);
    expect(createPronunciationAssessmentProviderFromEnvironment({
      ENABLE_PRONUNCIATION_ASSESSMENT: 'false',
      AZURE_SPEECH_KEY: 'server-only-key',
      AZURE_SPEECH_REGION: 'eastus',
    }).available).toBe(false);
  });

  it('normalizes timeout and upstream failures without exposing response data', async () => {
    const timeoutFetch = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    const timeoutProvider = createAzurePronunciationAssessmentProvider({
      apiKey: 'server-only-key', region: 'eastus', fetchImpl: timeoutFetch, timeoutMs: 10,
    });
    await expect(timeoutProvider.assess(validParsedRequest())).rejects.toBeInstanceOf(PronunciationAssessmentTimeoutError);

    const failedProvider = createAzurePronunciationAssessmentProvider({
      apiKey: 'server-only-key',
      region: 'eastus',
      fetchImpl: vi.fn(async () => ({ ok: false, json: async () => ({ secret: 'must not escape' }) }) as Response),
    });
    await expect(failedProvider.assess(validParsedRequest())).rejects.toBeInstanceOf(PronunciationAssessmentProviderError);
    await expect(failedProvider.assess(validParsedRequest())).rejects.not.toThrow('must not escape');
  });

  it('opens a circuit after repeated provider failures and allows recovery after cooldown', async () => {
    let now = 0;
    const failure = new Error('temporary provider failure');
    const assess = vi.fn()
      .mockRejectedValueOnce(failure)
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({
        provider: 'azure-speech', status: 'success', locale: 'en-US', activityId: 'shadow-1',
        accuracy: null, fluency: null, completeness: null, prosody: null, words: null,
      } as PronunciationAssessmentResult);
    const circuit = createPronunciationAssessmentCircuit({
      available: true,
      assess,
    }, { failureLimit: 2, cooldownMs: 100, now: () => now });

    await expect(circuit.assess(validParsedRequest())).rejects.toBe(failure);
    await expect(circuit.assess(validParsedRequest())).rejects.toBe(failure);
    await expect(circuit.assess(validParsedRequest())).rejects.toBeInstanceOf(PronunciationAssessmentCircuitOpenError);
    expect(assess).toHaveBeenCalledTimes(2);
    now = 101;
    await expect(circuit.assess(validParsedRequest())).resolves.toMatchObject({ status: 'success' });
    expect(assess).toHaveBeenCalledTimes(3);
  });
});

describe('pronunciation callable boundary', () => {
  it('keeps the provider callable protected, budgeted, and secret-free at deploy time', () => {
    const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    const start = source.indexOf('export const assessPronunciation');
    const end = source.indexOf('\nexport const ', start + 1);
    const callable = source.slice(start, end === -1 ? source.length : end);

    expect(callable).toContain('onCall({');
    expect(callable).toContain('enforceAppCheck');
    expect(callable).toContain('requireUser(request.auth)');
    expect(callable).toContain('consumeBudget');
    expect(callable).toContain('pronunciation-assessment-service');
    expect(callable).toContain('pronunciationAssessmentProvider.available');
    expect(source).not.toContain("defineSecret('AZURE_SPEECH_KEY')");
    expect(source).not.toContain('secrets: [azure');
  });
});
