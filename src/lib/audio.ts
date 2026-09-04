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

export function playWordAudio(word: string, audioUrl: string | null) {
  if (isSupportedAudioUrl(audioUrl)) {
    const audio = new Audio(audioUrl);
    audio.play().catch(err => {
      console.warn('Audio URL failed, falling back to TTS', err);
      speakFallback(word);
    });
  } else {
    speakFallback(word);
  }
}

export function cancelSpeech() {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
}

const speakNow = (text: string) => {
  const normalized = text.trim();
  if (!normalized || typeof window === 'undefined'
    || !('speechSynthesis' in window)
    || typeof SpeechSynthesisUtterance === 'undefined') return;
  cancelSpeech();
  const utterance = new SpeechSynthesisUtterance(normalized);
  utterance.lang = 'en-US';
  utterance.rate = 0.9;
  window.speechSynthesis.speak(utterance);
};

export function speakText(text: string) {
  speakNow(text);
}

function speakFallback(text: string) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)
    || typeof SpeechSynthesisUtterance === 'undefined') return;
  setTimeout(() => speakNow(text), 50);
}
