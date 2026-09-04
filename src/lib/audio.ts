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

function speakFallback(text: string) {
  if ('speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined') {
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
    }
    setTimeout(() => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.rate = 0.9;
      window.speechSynthesis.speak(utterance);
    }, 50);
  }
}
