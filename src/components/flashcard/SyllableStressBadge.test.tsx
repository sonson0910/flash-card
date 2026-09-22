import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('SyllableStressBadge audio lifecycle', () => {
  it('uses the shared playback handle and cancels it on replay, word changes, and unmount', () => {
    const source = readFileSync(new URL('./SyllableStressBadge.tsx', import.meta.url), 'utf8');

    expect(source).toContain("import { playWordAudio, type WordAudioPlayback } from '../../lib/audio'");
    expect(source).toContain('playbackRef.current?.cancel()');
    expect(source).toContain('useEffect(() => () => playbackRef.current?.cancel(), [word])');
    expect(source).toContain("playWordAudio(syllable.text, null, { speed: 0.75 })");
  });
});
