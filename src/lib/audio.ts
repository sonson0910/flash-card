import { isSupportedAudioUrl as isSupportedAbsoluteAudioUrl } from './mediaUrlPolicy';

/** Legacy display inputs may be protocol-relative; persisted URLs must use the leaf policy directly. */
export function isSupportedAudioUrl(url: string | null | undefined): url is string {
  const normalized = url?.startsWith('//') ? `https:${url}` : url;
  return isSupportedAbsoluteAudioUrl(normalized);
}

export async function fetchAudioUrl(word: string): Promise<string | null> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, {
      signal: controller.signal
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      const phonetics = data[0].phonetics;
      if (Array.isArray(phonetics)) {
        const audioObj = phonetics.find((p: any) => p.audio && p.audio.length > 0);
        if (audioObj) {
          const audioUrl = String(audioObj.audio);
          const normalized = audioUrl.startsWith('//') ? `https:${audioUrl}` : audioUrl;
          return isSupportedAudioUrl(normalized) ? normalized : null;
        }
      }
    }
    return null;
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'AbortError')) {
      console.error('Failed to fetch audio', error);
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function playCorrectSound() {
  const AudioContextConstructor = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextConstructor) return;
  const ctx = new AudioContextConstructor();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
  osc.frequency.exponentialRampToValueAtTime(1046.50, ctx.currentTime + 0.1); // C6
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.addEventListener('ended', () => void ctx.close(), { once: true });
  osc.start();
  osc.stop(ctx.currentTime + 0.4);
}

export function playIncorrectSound() {
  const AudioContextConstructor = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextConstructor) return;
  const ctx = new AudioContextConstructor();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(300, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(150, ctx.currentTime + 0.3);
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.addEventListener('ended', () => void ctx.close(), { once: true });
  osc.start();
  osc.stop(ctx.currentTime + 0.3);
}

export interface WordAudioPlayback {
  cancel(): void;
}

let currentSpeechPlayback: WordAudioPlayback | null = null;

export function playWordAudio(
  word: string,
  audioUrl: string | null,
  speechLocale = 'en-US',
  voice?: SpeechSynthesisVoice,
): WordAudioPlayback {
  if (isSupportedAudioUrl(audioUrl)) {
    const audio = new Audio(audioUrl);
    let cancelled = false;
    let fallback: WordAudioPlayback | null = null;
    audio.play().catch(err => {
      if (cancelled) return;
      console.warn('Audio URL failed, falling back to TTS', err);
      fallback = speakFallback(word, speechLocale, voice);
    });
    return {
      cancel() {
        if (cancelled) return;
        cancelled = true;
        audio.pause();
        audio.currentTime = 0;
        fallback?.cancel();
      },
    };
  } else {
    return speakFallback(word, speechLocale, voice);
  }
}

function speakFallback(text: string, speechLocale: string, voice?: SpeechSynthesisVoice): WordAudioPlayback {
  if (typeof window === 'undefined' || !window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') {
    return { cancel() {} };
  }

  currentSpeechPlayback?.cancel();
  const speechSynthesis = window.speechSynthesis;
  const utterance = new SpeechSynthesisUtterance(text);
  let cancelled = false;
  let active = false;
  let queued = false;
  const playback: WordAudioPlayback = {
    cancel() {
      if (cancelled) return;
      cancelled = true;
      utterance.volume = 0;
      if (currentSpeechPlayback !== playback) return;
      currentSpeechPlayback = null;
      if (queued || active) speechSynthesis.cancel();
    },
  };
  currentSpeechPlayback = playback;
  utterance.lang = speechLocale;
  if (voice) utterance.voice = voice;
  utterance.rate = 0.9;
  utterance.onstart = () => {
    if (cancelled) {
      utterance.volume = 0;
      return;
    }
    queued = false;
    active = true;
  };
  utterance.onend = () => {
    queued = false;
    active = false;
    if (currentSpeechPlayback === playback) currentSpeechPlayback = null;
  };
  if (!cancelled) {
    queued = true;
    try {
      // Keep speech synthesis in the originating click call stack. Some
      // browsers reject a delayed speak() as no longer user initiated.
      speechSynthesis.speak(utterance);
    } catch (error) {
      queued = false;
      if (currentSpeechPlayback === playback) currentSpeechPlayback = null;
      console.warn('Speech synthesis failed', error);
    }
  }
  return playback;
}
