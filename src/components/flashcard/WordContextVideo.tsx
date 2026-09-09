import { useEffect, useRef, useState } from 'react';
import { LISTEN_MVP_PILOT_LESSONS_DATA } from '../../features/listenMvp/listenMvpPilotData';
import { mediaButtonClass, mediaPanelClass, stopMediaEvent } from './PronunciationVideo';

const cueIndex: Readonly<Record<string, number>> = {
  news: 1, information: 1, new: 1, ready: 3, work: 3, trip: 3,
  travel: 4, shirt: 4, sunglasses: 4, guidebook: 4,
};
// The original video corresponding to the already-published, reviewed VOA audio.
const sourcePage = 'https://learningenglish.voanews.com/a/7949136.html';
const videoUrl = 'https://voa-video.voanews.eu/pangeavideo/2025/01/f/fc/fc61b5bf-93ed-4750-af4e-696d55014281_240p.mp4';

export function contextForWord(word: string) {
  const normalized = word.trim().toLowerCase();
  return Object.hasOwn(cueIndex, normalized)
    ? LISTEN_MVP_PILOT_LESSONS_DATA[0].clip.transcriptCues[cueIndex[normalized]]
    : undefined;
}

export function WordContextVideo({ word }: { word: string }) {
  const normalized = word.trim().toLowerCase();
  const cue = contextForWord(normalized);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loadedWord, setLoadedWord] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [captions, setCaptions] = useState<string | null>(null);
  useEffect(() => {
    if (!cue || loadedWord !== normalized) return;
    const time = (ms: number) => new Date(ms).toISOString().slice(11, 23);
    const url = URL.createObjectURL(new Blob([`WEBVTT\n\n${time(cue.startMs)} --> ${time(cue.endMs)}\n${cue.text}\n`], { type: 'text/vtt' }));
    setCaptions(url);
    return () => { URL.revokeObjectURL(url); setCaptions(null); };
  }, [cue, loadedWord, normalized]);
  if (!cue) return null;
  const start = cue.startMs / 1000;
  const end = cue.endMs / 1000;
  const buttonClass = mediaButtonClass;
  return <section data-card-control aria-label={`Context clip for ${normalized}`} className={mediaPanelClass} onClick={stopMediaEvent} onPointerDown={stopMediaEvent} onKeyDown={stopMediaEvent}>
    <p className="text-sm font-bold">Word in context · {end - start} seconds</p>
    <p aria-label="Clip transcript" className="text-sm">
      {cue.text.split(/(\s+)/).map((part, index) => part.replace(/[^a-z]/gi, '').toLowerCase() === normalized ? <mark key={index}>{part}</mark> : part)}
    </p>
    {loadedWord === normalized ? <>
      <video ref={videoRef} controls playsInline crossOrigin="anonymous" preload="metadata" aria-label={`Context video: ${normalized}`} src={`${videoUrl}#t=${start},${end}`} className="aspect-video min-h-[200px] w-full rounded-lg"
        onLoadedMetadata={event => { event.currentTarget.currentTime = start; }}
        onTimeUpdate={event => { if (event.currentTarget.currentTime >= end) event.currentTarget.pause(); }}
        onSeeking={event => { const video = event.currentTarget; if (video.currentTime < start || video.currentTime > end) video.currentTime = start; }}
        onPlay={event => { if (event.currentTarget.currentTime >= end) event.currentTarget.currentTime = start; }}
        onError={() => { setError(true); setLoadedWord(null); }}>
        {captions && <track kind="captions" label="English" srcLang="en" src={captions} default />}
      </video>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass} onClick={() => { const video = videoRef.current; if (video) { video.currentTime = start; void video.play().catch(() => setError(true)); } }}>Replay context clip</button>
        <button type="button" className={buttonClass} onClick={() => setLoadedWord(null)}>Close context clip</button>
      </div>
    </> : <button type="button" className={buttonClass} onClick={() => { setError(false); setLoadedWord(normalized); }}>Load context clip</button>}
    {error && <p role="status" className="text-sm">Video unavailable. Use text, audio or the source. No incorrect answer is recorded.</p>}
    <a href={sourcePage} target="_blank" rel="noopener noreferrer" className="text-sm underline">Voice of America Learning English · Source</a>
    <p className="text-xs text-[var(--sf-text-muted)]">VOA video loads only on request. Listen, pause and repeat; recording is optional.</p>
  </section>;
}
