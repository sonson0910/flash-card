/** How often the live microphone level is sampled while a take is recorded. */
export const MIC_LEVEL_INTERVAL_MS = 80;

export type MicLevelStatus = 'starting' | 'live' | 'denied' | 'unavailable';

export interface MicLevelCapture {
  stop(): void;
}

interface AnalyserLike {
  fftSize: number;
  getByteTimeDomainData(data: Uint8Array): void;
}

interface AudioContextLike {
  createMediaStreamSource(stream: MediaStream): { connect(node: AnalyserLike): unknown };
  createAnalyser(): AnalyserLike;
  close(): Promise<void>;
}

/** The browser surface the capture needs, injectable so it can run without a microphone. */
export interface MicLevelEnvironment {
  navigator?: { mediaDevices?: { getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream> } };
  AudioContext?: new () => AudioContextLike;
  webkitAudioContext?: new () => AudioContextLike;
  setInterval: (callback: () => void, ms: number) => unknown;
  clearInterval: (handle: never) => void;
}

interface MicLevelOptions {
  onLevel: (level: number) => void;
  onStatus: (status: MicLevelStatus) => void;
  env?: MicLevelEnvironment;
}

/**
 * Reads the loudness of the learner's microphone while they record a take, for the take
 * waveform. It is separate from speech recognition: when the browser has no audio API or the
 * learner refuses the microphone, the capture reports why and recognition carries on.
 */
export function captureMicLevels({ onLevel, onStatus, env = globalThis as unknown as MicLevelEnvironment }: MicLevelOptions): MicLevelCapture {
  const getUserMedia = env.navigator?.mediaDevices?.getUserMedia?.bind(env.navigator.mediaDevices);
  const AudioContextConstructor = env.AudioContext ?? env.webkitAudioContext;
  if (!getUserMedia || !AudioContextConstructor) {
    onStatus('unavailable');
    return { stop() {} };
  }

  let stopped = false;
  let stream: MediaStream | null = null;
  let context: AudioContextLike | null = null;
  let timer: unknown = null;
  const release = () => {
    if (timer !== null) env.clearInterval(timer as never);
    timer = null;
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
    void context?.close().catch(() => undefined);
    context = null;
  };

  onStatus('starting');
  let request: Promise<MediaStream>;
  try {
    request = getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (error) {
    onStatus(isPermissionError(error) ? 'denied' : 'unavailable');
    return { stop() {} };
  }
  request.then(granted => {
    if (stopped) {
      granted.getTracks().forEach(track => track.stop());
      return;
    }
    stream = granted;
    try {
      context = new AudioContextConstructor();
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(granted).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      onStatus('live');
      timer = env.setInterval(() => {
        analyser.getByteTimeDomainData(samples);
        onLevel(levelOf(samples));
      }, MIC_LEVEL_INTERVAL_MS);
    } catch {
      release();
      onStatus('unavailable');
    }
  }, error => {
    if (!stopped) onStatus(isPermissionError(error) ? 'denied' : 'unavailable');
  });

  return {
    stop() {
      stopped = true;
      release();
    },
  };
}

const isPermissionError = (error: unknown) => {
  const name = (error as { name?: unknown } | null)?.name;
  return name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError';
};

/** Root-mean-square loudness of 8-bit time-domain samples, scaled so speech fills most of 0…1. */
export function levelOf(samples: Uint8Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) {
    const centred = (sample - 128) / 128;
    sum += centred * centred;
  }
  return Math.min(1, Math.sqrt(sum / samples.length) * 4);
}

export interface AudioPeaks {
  readonly peaks: number[];
  readonly duration: number;
}

/**
 * The loudness outline of a card's recorded pronunciation, for the model waveform. Returns
 * null when the clip cannot be fetched or decoded (no audio API, offline, cross-origin), so
 * the screen can say the model is spoken by the browser voice instead.
 */
export async function loadAudioPeaks(url: string, bars: number, signal?: AbortSignal): Promise<AudioPeaks | null> {
  const OfflineContext = (globalThis as { OfflineAudioContext?: new (channels: number, length: number, rate: number) => BaseAudioContext }).OfflineAudioContext;
  if (!OfflineContext || bars <= 0) return null;
  try {
    const response = await fetch(url, { signal });
    if (!response.ok) return null;
    const buffer = await new OfflineContext(1, 1, 44_100).decodeAudioData(await response.arrayBuffer());
    return { peaks: peaksOf(buffer.getChannelData(0), bars), duration: buffer.duration };
  } catch {
    return null;
  }
}

/** The loudest sample in each of `bars` equal slices, scaled so the loudest slice is 1. */
export function peaksOf(channel: Float32Array, bars: number): number[] {
  if (bars <= 0) return [];
  const size = Math.max(1, Math.floor(channel.length / bars));
  const raw = Array.from({ length: bars }, (_, index) => {
    let peak = 0;
    const end = Math.min(channel.length, (index + 1) * size);
    for (let position = index * size; position < end; position += 1) peak = Math.max(peak, Math.abs(channel[position]!));
    return peak;
  });
  const loudest = Math.max(...raw);
  return loudest > 0 ? raw.map(peak => peak / loudest) : raw;
}

/** "0:03.4": minutes, seconds and tenths, as the take timers read. */
export function formatTakeClock(seconds: number): string {
  const tenths = Math.max(0, Math.round(seconds * 10));
  const minutes = Math.floor(tenths / 600);
  const rest = (tenths % 600) / 10;
  return `${minutes}:${rest.toFixed(1).padStart(4, '0')}`;
}
