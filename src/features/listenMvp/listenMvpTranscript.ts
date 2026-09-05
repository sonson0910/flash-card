import type { CatalogMediaClipV1, CatalogTranscriptCueV1 } from '../catalogPipeline/catalogContracts';

export const activeListenTranscriptCue = (
  clip: CatalogMediaClipV1,
  currentTimeMs: number,
): CatalogTranscriptCueV1 | null => {
  if (!Number.isFinite(currentTimeMs) || currentTimeMs < 0) return null;
  return clip.transcriptCues.find(cue => (
    currentTimeMs >= cue.startMs && currentTimeMs < cue.endMs
  )) ?? null;
};

export const initialListenCueId = (clip: CatalogMediaClipV1): string | null => (
  activeListenTranscriptCue(clip, 0)?.id ?? null
);
