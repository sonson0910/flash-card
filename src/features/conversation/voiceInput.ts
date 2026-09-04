export const VOICE_INPUT_TIMEOUT_MS = 8_000;

export type VoiceInputState = 'idle' | 'listening' | 'stopping';
export type VoiceInputErrorCode = 'unsupported' | 'denied' | 'timeout' | 'runtime';

export interface VoiceInputUsage {
  readonly kind: 'unavailable';
  readonly reason: 'browser-recognition-meter';
}

export interface VoiceInputAlternative {
  readonly transcript?: unknown;
}

export interface VoiceInputResult {
  readonly isFinal?: boolean;
  readonly 0?: VoiceInputAlternative;
}

export interface VoiceInputResultEvent {
  readonly results?: readonly VoiceInputResult[];
}

export interface VoiceInputErrorEvent {
  readonly error?: unknown;
}

export interface VoiceInputRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: VoiceInputResultEvent) => void) | null;
  onerror: ((event: VoiceInputErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

export type VoiceInputConstructor = new () => VoiceInputRecognition;

export interface VoiceInputEnvironment {
  readonly SpeechRecognition?: VoiceInputConstructor;
  readonly webkitSpeechRecognition?: VoiceInputConstructor;
}

export interface VoiceInputCallbacks {
  readonly onState: (state: VoiceInputState) => void;
  readonly onTranscript: (transcript: string) => void;
  readonly onError: (error: VoiceInputErrorCode) => void;
}

export interface VoiceInputAdapter {
  readonly supported: boolean;
  readonly usage: VoiceInputUsage;
  subscribe(callbacks: VoiceInputCallbacks): () => void;
  start(): boolean;
  stop(): void;
}

const browserEnvironment = (): VoiceInputEnvironment => (
  typeof window === 'undefined'
    ? {}
    : window as unknown as VoiceInputEnvironment
);

const errorCode = (value: unknown): VoiceInputErrorCode => {
  const code = typeof value === 'string' ? value.toLocaleLowerCase() : '';
  return code === 'not-allowed' || code === 'service-not-allowed' ? 'denied' : 'runtime';
};

export const isVoiceInputEnabled = (
  environment: unknown = import.meta.env,
): boolean => typeof environment === 'object'
  && environment !== null
  && 'VITE_ENABLE_VOICE_INPUT' in environment
  && (environment as { readonly VITE_ENABLE_VOICE_INPUT?: unknown }).VITE_ENABLE_VOICE_INPUT === 'true';

export const createBrowserVoiceInputAdapter = (
  environment: VoiceInputEnvironment = browserEnvironment(),
): VoiceInputAdapter => {
  const Recognition = environment.SpeechRecognition ?? environment.webkitSpeechRecognition;
  const listeners = new Set<VoiceInputCallbacks>();
  const usage: VoiceInputUsage = Object.freeze({
    kind: 'unavailable',
    reason: 'browser-recognition-meter',
  });
  let active: { recognition: VoiceInputRecognition; timeoutId: number } | null = null;

  const publishState = (state: VoiceInputState) => {
    listeners.forEach(callbacks => callbacks.onState(state));
  };

  const publishError = (error: VoiceInputErrorCode) => {
    listeners.forEach(callbacks => callbacks.onError(error));
  };

  const clearActive = (state: VoiceInputState = 'idle') => {
    const current = active;
    if (!current) return;
    active = null;
    globalThis.clearTimeout(current.timeoutId);
    try {
      current.recognition.stop();
    } catch {
      // Browser implementations may throw when the recognizer has already ended.
    }
    publishState(state);
  };

  return {
    supported: Boolean(Recognition),
    usage,
    subscribe(callbacks) {
      listeners.add(callbacks);
      return () => listeners.delete(callbacks);
    },
    start() {
      if (!Recognition) {
        publishError('unsupported');
        return false;
      }
      if (active) return false;

      let recognition: VoiceInputRecognition;
      try {
        recognition = new Recognition();
      } catch {
        publishError('runtime');
        return false;
      }

      const timeoutId = globalThis.setTimeout(() => {
        if (!active || active.recognition !== recognition) return;
        clearActive();
        publishError('timeout');
      }, VOICE_INPUT_TIMEOUT_MS) as unknown as number;
      active = { recognition, timeoutId };
      recognition.lang = 'en-US';
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.onstart = () => {
        if (active?.recognition === recognition) publishState('listening');
      };
      recognition.onresult = event => {
        if (active?.recognition !== recognition) return;
        const result = event.results?.[0];
        if (!result || result.isFinal === false) return;
        const transcript = result[0]?.transcript;
        if (typeof transcript !== 'string' || !transcript.trim()) return;
        listeners.forEach(callbacks => callbacks.onTranscript(transcript));
        clearActive();
      };
      recognition.onerror = event => {
        if (active?.recognition !== recognition) return;
        const error = errorCode(event.error);
        clearActive();
        publishError(error);
      };
      recognition.onend = () => {
        if (active?.recognition !== recognition) return;
        clearActive();
        publishError('runtime');
      };

      publishState('listening');
      try {
        recognition.start();
      } catch {
        clearActive();
        publishError('runtime');
        return false;
      }
      return true;
    },
    stop() {
      if (!active) return;
      publishState('stopping');
      clearActive();
    },
  };
};
