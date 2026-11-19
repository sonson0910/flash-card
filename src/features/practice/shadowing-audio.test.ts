import { describe, expect, it, vi } from 'vitest';
import { MIC_LEVEL_INTERVAL_MS, captureMicLevels, formatTakeClock, levelOf, peaksOf, type MicLevelEnvironment } from './shadowing-audio';
import { markSentence, sentenceWords } from './shadowing-words';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function environment(getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>) {
  const intervals: Array<() => void> = [];
  const close = vi.fn(async () => undefined);
  const connect = vi.fn();
  const env: MicLevelEnvironment = {
    navigator: getUserMedia ? { mediaDevices: { getUserMedia } } : {},
    AudioContext: class {
      createMediaStreamSource() { return { connect }; }
      createAnalyser() {
        return { fftSize: 0, getByteTimeDomainData(data: Uint8Array) { data.fill(160); } };
      }
      close = close;
    },
    setInterval: (callback: () => void) => { intervals.push(callback); return intervals.length; },
    clearInterval: vi.fn(),
  };
  return { env, intervals, close, connect };
}

const stream = () => {
  const track = { stop: vi.fn() };
  return { stream: { getTracks: () => [track] } as unknown as MediaStream, track };
};

describe('microphone levels for the take waveform', () => {
  it('reports denied, and never samples, when the learner refuses the microphone', async () => {
    const denied = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
    const { env, intervals } = environment(vi.fn(() => Promise.reject(denied)));
    const onStatus = vi.fn();
    const onLevel = vi.fn();

    const capture = captureMicLevels({ onLevel, onStatus, env });
    await flush();

    expect(onStatus.mock.calls.map(([status]) => status)).toEqual(['starting', 'denied']);
    expect(intervals).toHaveLength(0);
    expect(onLevel).not.toHaveBeenCalled();
    expect(() => capture.stop()).not.toThrow();
  });

  it('reports unavailable without asking when the browser has no microphone API', () => {
    const onStatus = vi.fn();
    const { env } = environment();
    captureMicLevels({ onLevel: vi.fn(), onStatus, env });
    expect(onStatus).toHaveBeenCalledExactlyOnceWith('unavailable');
  });

  it('reports unavailable when the request itself throws or fails for another reason', async () => {
    const throwing = vi.fn(() => { throw new TypeError('insecure context'); });
    const first = vi.fn();
    captureMicLevels({ onLevel: vi.fn(), onStatus: first, env: environment(throwing).env });
    expect(first.mock.calls.at(-1)).toEqual(['unavailable']);

    const missing = Object.assign(new Error('No device'), { name: 'NotFoundError' });
    const second = vi.fn();
    captureMicLevels({ onLevel: vi.fn(), onStatus: second, env: environment(vi.fn(() => Promise.reject(missing))).env });
    await flush();
    expect(second.mock.calls.at(-1)).toEqual(['unavailable']);
  });

  it('samples loudness while live and releases the microphone when stopped', async () => {
    const { stream: granted, track } = stream();
    const { env, intervals, close, connect } = environment(vi.fn(async () => granted));
    const onLevel = vi.fn();
    const onStatus = vi.fn();

    const capture = captureMicLevels({ onLevel, onStatus, env });
    await flush();
    expect(onStatus.mock.calls.at(-1)).toEqual(['live']);
    expect(connect).toHaveBeenCalledOnce();
    intervals[0]!();
    expect(onLevel).toHaveBeenCalledOnce();
    expect(onLevel.mock.calls[0]![0]).toBeCloseTo(1);

    capture.stop();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(env.clearInterval).toHaveBeenCalledOnce();
  });

  it('stops a microphone that is granted after the take already ended', async () => {
    let grant: (value: MediaStream) => void = () => undefined;
    const { stream: granted, track } = stream();
    const { env, intervals } = environment(vi.fn(() => new Promise<MediaStream>(resolve => { grant = resolve; })));
    const onStatus = vi.fn();

    captureMicLevels({ onLevel: vi.fn(), onStatus, env }).stop();
    grant(granted);
    await flush();

    expect(track.stop).toHaveBeenCalledOnce();
    expect(intervals).toHaveLength(0);
    expect(onStatus.mock.calls.map(([status]) => status)).toEqual(['starting']);
  });

  it('turns samples into a 0 to 1 loudness and outlines a clip as peaks', () => {
    expect(levelOf(new Uint8Array(64).fill(128))).toBe(0);
    expect(levelOf(new Uint8Array([128, 160, 96, 128]))).toBeCloseTo(Math.min(1, Math.sqrt((0.25 ** 2 * 2) / 4) * 4));
    expect(peaksOf(new Float32Array([0, 0.5, -1, 0.25, 0.1, 0.05]), 3).map(peak => Number(peak.toFixed(3)))).toEqual([0.5, 1, 0.1]);
    expect(peaksOf(new Float32Array(4), 2)).toEqual([0, 0]);
  });

  it('formats take clocks in minutes, seconds and tenths', () => {
    expect(formatTakeClock((26 * MIC_LEVEL_INTERVAL_MS) / 1000)).toBe('0:02.1');
    expect(formatTakeClock(3.4)).toBe('0:03.4');
    expect(formatTakeClock(65.25)).toBe('1:05.3');
  });
});

describe('shadowing sentence marks', () => {
  it('leaves every word pending before a take and accents the focus word', () => {
    expect(markSentence('I need to recharge.', null, 'recharge', 'en')).toEqual([
      { text: 'I', mark: 'pending', focus: false },
      { text: 'need', mark: 'pending', focus: false },
      { text: 'to', mark: 'pending', focus: false },
      { text: 'recharge.', mark: 'pending', focus: true },
    ]);
  });

  it('marks words the browser heard as clear, near misses as close and the rest as missed', () => {
    const marks = markSentence('I need a quiet weekend to recharge my batteries.', 'I need a white weekend to recharge my battery', 'recharge', 'en');
    expect(marks.map(word => `${word.text}:${word.mark}`)).toEqual([
      'I:clear', 'need:clear', 'a:clear', 'quiet:missed', 'weekend:clear', 'to:clear', 'recharge:clear', 'my:clear', 'batteries.:close',
    ]);
  });

  it('compares words without case, accents or punctuation', () => {
    expect(markSentence('Un café, s’il vous plaît.', 'un cafe sil vous plait', 'café', 'fr').every(word => word.mark === 'clear')).toBe(true);
  });

  it('splits scripts written without spaces into words', () => {
    expect(sentenceWords('私は学校に行きます。', 'ja').length).toBeGreaterThan(1);
    expect(sentenceWords('私は学校に行きます。', 'ja').join('')).toBe('私は学校に行きます。');
  });
});
