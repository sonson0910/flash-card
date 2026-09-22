import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('PracticeScreen session lifecycle', () => {
  it('remounts stateful study and recognition views for each session', () => {
    const source = readFileSync(new URL('./PracticeScreen.tsx', import.meta.url), 'utf8');

    expect(source).toMatch(/<StudyView\s+key=\{session\.sessionKey\}/);
    expect(source).toMatch(/<ShadowingView\s+key=\{session\.sessionKey\}/);
  });
});
