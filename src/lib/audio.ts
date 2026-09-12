import { isSupportedAudioUrl as isSupportedAbsoluteAudioUrl } from './mediaUrlPolicy';

export { playIncorrectSound, playSuccessSound as playCorrectSound } from './interactionSounds';

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

let contentPlaybackStop: (() => void) | null = null;

/** Ownership is shared by study content; feedback sounds have their own channel. */
export function claimContentPlayback(stop: () => void): () => void {
  const previous = contentPlaybackStop;
  contentPlaybackStop = null;
  previous?.();
  contentPlaybackStop = stop;
  return () => { if (contentPlaybackStop === stop) contentPlaybackStop = null; };
}

const speechFailureMessage = 'Audio could not be played. Check this site’s audio permission and try again.';

interface WordAudioOptions extends SpeechCallbacks {
  audio?: HTMLAudioElement | null;
  speed?: 1 | 0.75;
}

export function playWordAudio(word: string, audioUrl: string | null, options: WordAudioOptions = {}): () => void {
  let active = true;
  let audio: HTMLAudioElement | null = null;
  let speaking = false;
  const stop = () => {
    if (!active) return;
    active = false;
    if (audio) {
      audio.pause();
      audio.onended = null;
      audio.onerror = null;
      try { audio.currentTime = 0; } catch { /* An unloaded stream may not seek. */ }
    }
    if (speaking) cancelSpeech();
    release();
    options.onEnd?.();
  };
  const release = claimContentPlayback(stop);
  const fail = (message: string) => { if (active) { options.onError?.(message); stop(); } };
  const fallback = () => {
    if (!active || speaking) return;
    audio?.pause();
    speaking = true;
    try {
      if (!speakNow(word, {
        onEnd: stop,
        onError: () => fail(speechFailureMessage),
      }, options.speed === 0.75 ? 0.65 : 0.9)) fail('Audio playback is not supported by this browser.');
    } catch { fail(speechFailureMessage); }
  };
  try {
    audio = options.audio !== undefined ? options.audio : isSupportedAudioUrl(audioUrl)
      ? new Audio(audioUrl.startsWith('//') ? `https:${audioUrl}` : audioUrl) : null;
    if (audio) {
      try { audio.currentTime = 0; audio.playbackRate = options.speed ?? 1; } catch { /* Safari may not seek yet. */ }
      audio.onended = () => { if (!speaking) stop(); };
      audio.onerror = fallback;
      void Promise.resolve(audio.play()).catch(error => {
        if (active && !speaking) console.warn('Audio play failed, using web speech fallback:', error);
        fallback();
      });
    } else {
      // Direct TTS stays in the original user gesture, including on Safari.
      fallback();
    }
  } catch { fallback(); }
  return stop;
}

export function cancelSpeech() {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
}

export interface SpeechCallbacks {
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error: string) => void;
}

const speakNow = (text: string, callbacks: SpeechCallbacks = {}, rate = 0.9): boolean => {
  const normalized = text.trim();
  if (!normalized || typeof window === 'undefined'
    || !('speechSynthesis' in window)
    || typeof SpeechSynthesisUtterance === 'undefined') return false;
  cancelSpeech();
  const utterance = new SpeechSynthesisUtterance(normalized);
  utterance.lang = 'en-US';
  utterance.rate = rate;
  utterance.onstart = () => callbacks.onStart?.();
  utterance.onend = () => callbacks.onEnd?.();
  utterance.onerror = event => callbacks.onError?.(event?.error ?? 'speech-failed');
  window.speechSynthesis.resume?.();
  window.speechSynthesis.speak(utterance);
  return true;
};

export function speakText(text: string, callbacks?: SpeechCallbacks): boolean {
  return speakNow(text, callbacks);
}
