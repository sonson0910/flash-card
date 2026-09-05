import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  VOICE_INPUT_TIMEOUT_MS,
  createBrowserVoiceInputAdapter,
  isVoiceInputEnabled,
  type VoiceInputAdapter,
  type VoiceInputEnvironment,
  type VoiceInputRecognition,
} from './voiceInput';

class FakeRecognition implements VoiceInputRecognition {
  lang = '';
  continuous = true;
  interimResults = true;
  maxAlternatives = 0;
  onstart: (() => void) | null = null;
  onresult: VoiceInputRecognition['onresult'] = null;
  onerror: VoiceInputRecognition['onerror'] = null;
  onend: (() => void) | null = null;
  readonly start = vi.fn();
  readonly stop = vi.fn();
}

const createFakeEnvironment = () => {
  const instances: FakeRecognition[] = [];
  class Constructor extends FakeRecognition {
    constructor() {
      super();
      instances.push(this);
    }
  }
  return {
    environment: { SpeechRecognition: Constructor } satisfies VoiceInputEnvironment,
    instances,
  };
};

const subscribe = (adapter: VoiceInputAdapter) => {
  const states: string[] = [];
  const transcripts: string[] = [];
  const errors: string[] = [];
  adapter.subscribe({
    onState: state => states.push(state),
    onTranscript: transcript => transcripts.push(transcript),
    onError: error => errors.push(error),
  });
  return { states, transcripts, errors };
};

afterEach(() => {
  vi.useRealTimers();
});

describe('browser voice input adapter', () => {
  it('detects support, configures push-to-talk, and returns only final transcript text', () => {
    const fake = createFakeEnvironment();
    const adapter = createBrowserVoiceInputAdapter(fake.environment);
    const events = subscribe(adapter);

    expect(adapter.supported).toBe(true);
    expect(adapter.usage).toEqual({ kind: 'unavailable', reason: 'browser-recognition-meter' });
    expect(adapter.start()).toBe(true);

    const recognition = fake.instances[0];
    expect(recognition).toBeDefined();
    expect(recognition.lang).toBe('en-US');
    expect(recognition.continuous).toBe(false);
    expect(recognition.interimResults).toBe(false);
    expect(recognition.maxAlternatives).toBe(1);

    recognition.onresult?.({ results: [{ isFinal: false, 0: { transcript: 'interim' } }] });
    recognition.onresult?.({ results: [{ isFinal: true, 0: { transcript: '  hello there  ' } }] });
    recognition.onend?.();

    expect(events.transcripts).toEqual(['  hello there  ']);
    expect(events.errors).toEqual([]);
    expect(recognition.stop).toHaveBeenCalledOnce();
    expect(events.states).toContain('listening');
  });

  it('reports unsupported browsers without trying to start recognition', () => {
    const adapter = createBrowserVoiceInputAdapter({});
    const events = subscribe(adapter);

    expect(adapter.supported).toBe(false);
    expect(adapter.start()).toBe(false);
    expect(events.errors).toEqual(['unsupported']);
  });

  it('maps denied permission and runtime start failures to actionable lifecycle errors', () => {
    const fake = createFakeEnvironment();
    const adapter = createBrowserVoiceInputAdapter(fake.environment);
    const events = subscribe(adapter);
    adapter.start();
    fake.instances[0].onerror?.({ error: 'not-allowed' });

    expect(events.errors).toEqual(['denied']);

    class ThrowingRecognition extends FakeRecognition {
      constructor() {
        super();
        this.start.mockImplementation(() => {
          throw new Error('start failed');
        });
      }
    }
    const runtimeAdapter = createBrowserVoiceInputAdapter({ SpeechRecognition: ThrowingRecognition });
    const runtimeEvents = subscribe(runtimeAdapter);
    expect(runtimeAdapter.start()).toBe(false);
    expect(runtimeEvents.errors).toEqual(['runtime']);
  });

  it('stops and reports a timeout without retaining a stale transcript', () => {
    vi.useFakeTimers();
    const fake = createFakeEnvironment();
    const adapter = createBrowserVoiceInputAdapter(fake.environment);
    const events = subscribe(adapter);

    adapter.start();
    const recognition = fake.instances[0];
    vi.advanceTimersByTime(VOICE_INPUT_TIMEOUT_MS);
    recognition.onresult?.({ results: [{ isFinal: true, 0: { transcript: 'late result' } }] });

    expect(events.errors).toEqual(['timeout']);
    expect(events.transcripts).toEqual([]);
    expect(recognition.stop).toHaveBeenCalledOnce();
  });

  it('reports one runtime failure when recognition ends without a transcript', () => {
    const fake = createFakeEnvironment();
    const adapter = createBrowserVoiceInputAdapter(fake.environment);
    const events = subscribe(adapter);

    adapter.start();
    const recognition = fake.instances[0];
    recognition.onend?.();
    recognition.onend?.();

    expect(events.errors).toEqual(['runtime']);
  });

  it('does not report a failure for an explicit stop followed by onend', () => {
    const fake = createFakeEnvironment();
    const adapter = createBrowserVoiceInputAdapter(fake.environment);
    const events = subscribe(adapter);

    adapter.start();
    const recognition = fake.instances[0];
    adapter.stop();
    recognition.onend?.();

    expect(events.errors).toEqual([]);
  });

  it('ignores result events after explicit stop', () => {
    const fake = createFakeEnvironment();
    const adapter = createBrowserVoiceInputAdapter(fake.environment);
    const events = subscribe(adapter);

    adapter.start();
    const recognition = fake.instances[0];
    adapter.stop();
    recognition.onresult?.({ results: [{ isFinal: true, 0: { transcript: 'stale' } }] });

    expect(events.transcripts).toEqual([]);
    expect(events.states.at(-1)).toBe('idle');
  });

  it('keeps the voice feature disabled unless an explicit build flag is true', () => {
    expect(isVoiceInputEnabled({})).toBe(false);
    expect(isVoiceInputEnabled({ VITE_ENABLE_VOICE_INPUT: 'false' })).toBe(false);
    expect(isVoiceInputEnabled({ VITE_ENABLE_VOICE_INPUT: 'true' })).toBe(true);
  });
});
