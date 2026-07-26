export function isSupportedAudioUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const normalized = url.startsWith('//') ? `https:${url}` : url;
    const parsed = new URL(normalized);
    return parsed.protocol === 'https:'
      && ['api.dictionaryapi.dev', 'ssl.gstatic.com'].includes(parsed.hostname);
  } catch {
    return false;
  }
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
