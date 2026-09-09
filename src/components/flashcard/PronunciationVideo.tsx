import { useState } from 'react';
export const mediaButtonClass = 'min-h-11 rounded-xl border border-[var(--sf-border)] px-3 text-sm font-bold focus-visible:outline-2';
export const mediaPanelClass = 'my-3 space-y-3 rounded-xl border border-[var(--sf-border)] p-3 text-left';
export const stopMediaEvent = (event: { stopPropagation(): void }) => event.stopPropagation();

interface PronunciationLesson {
  videoId: string;
  end: number;
  source: string;
}

const workWalk = { videoId: 'slq3oXRF3EA', end: 261, source: 'pronounce-work-vs-walk' };
const wordWorld = { videoId: '8_Wwi1KUu_k', end: 98, source: 'pronounce-word-vs-world' };

// Verified against the author's pages and YouTube duration metadata, 2026-09-09.
// Full lessons, not falsely labelled word-level timestamped excerpts.
export const pronunciationLessons: Readonly<Record<string, PronunciationLesson>> = {
  water: { videoId: '0SqoJip29rw', end: 288, source: 'say-water' },
  comfortable: { videoId: 'XWNySmK01fg', end: 147, source: 'pronounce-comfortable' },
  work: workWalk,
  walk: workWalk,
  word: wordWorld,
  world: wordWorld,
  probably: { videoId: 'BS-UBBJdZ2U', end: 138, source: 'pronounce-probably' },
  schedule: { videoId: 'p0Utdnh4hg8', end: 131, source: 'pronounce-schedule' },
  and: { videoId: 'Fc91LLsE3iU', end: 230, source: 'english-pronunciation-pronounce-word' },
  can: { videoId: 'Vp7xmbtylqI', end: 220, source: 'pronounce-can-vs-cant' },
};

export function pronunciationEmbedUrl(lesson: PronunciationLesson): string {
  if (!/^[\w-]{11}$/.test(lesson.videoId) || !Number.isSafeInteger(lesson.end) || lesson.end <= 0 || lesson.end > 600) {
    throw new TypeError('Invalid pronunciation lesson');
  }
  const url = new URL(`https://www.youtube-nocookie.com/embed/${lesson.videoId}`);
  url.search = new URLSearchParams({ start: '0', end: String(lesson.end), autoplay: '0', cc_load_policy: '1', cc_lang_pref: 'en', playsinline: '1', rel: '0' }).toString();
  return url.href;
}

export function PronunciationVideo({ word }: { word: string }) {
  const normalized = word.trim().toLowerCase();
  const lesson = Object.hasOwn(pronunciationLessons, normalized) ? pronunciationLessons[normalized] : undefined;
  const [loadedWord, setLoadedWord] = useState<string | null>(null);
  const [replay, setReplay] = useState(0);
  if (!lesson) return null;
  const loaded = loadedWord === normalized;
  const buttonClass = mediaButtonClass;
  return (
    <section data-card-control aria-label={`Pronunciation video for ${normalized}`} className={mediaPanelClass} onClick={stopMediaEvent} onPointerDown={stopMediaEvent} onKeyDown={stopMediaEvent}>
      <p className="text-sm font-bold">Full pronunciation lesson · <mark>{normalized}</mark></p>
      <p className="text-xs text-[var(--sf-text-muted)]">Rachel’s English · American English. Watch, pause and repeat. YouTube captions when available.</p>
      {!loaded ? <button type="button" className={buttonClass} onClick={() => setLoadedWord(normalized)}>Load pronunciation video</button> : <>
        <iframe key={`${normalized}:${replay}`} title={`Pronunciation lesson: ${normalized}`} src={pronunciationEmbedUrl(lesson)} className="min-h-[200px] w-full aspect-video rounded-lg border-0" allow="fullscreen; encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass} onClick={() => setReplay(value => value + 1)}>Replay lesson</button>
          <button type="button" className={buttonClass} onClick={() => setLoadedWord(null)}>Close video</button>
        </div>
      </>}
      <p className="text-xs text-[var(--sf-text-muted)]">YouTube loads only on request. If unavailable, use word audio, text or the source link.</p>
      <div className="flex flex-wrap gap-4 text-sm underline">
        <a href={`https://www.youtube.com/watch?v=${lesson.videoId}`} target="_blank" rel="noopener noreferrer">Open on YouTube</a>
        <a href={`https://rachelsenglish.com/${lesson.source}/`} target="_blank" rel="noopener noreferrer">Source and lesson notes</a>
      </div>
    </section>
  );
}
