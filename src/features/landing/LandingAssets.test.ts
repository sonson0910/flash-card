import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = resolve(import.meta.dirname, '../../..');

describe('landing visual direction', () => {
  it('ships the local hero and study assets used by the six-scene story', () => {
    for (const asset of ['public/marketing/sonflash-memory-object-v2.webp', 'public/marketing/sonflash-study-preview.png']) {
      const path = resolve(projectRoot, asset);
      expect(existsSync(path)).toBe(true);
      expect(statSync(path).size).toBeGreaterThan(0);
    }
  });

  it('does not reintroduce external atmosphere media', () => {
    const source = [
      'LandingPage.tsx',
      'LandingScenes.tsx',
    ].map(file => readFileSync(resolve(projectRoot, 'src/features/landing', file), 'utf8')).join('\n');
    expect(source).not.toContain('<video');
    expect(source).not.toContain('figma.site');
    expect(source).toContain('LandingMotion');
    expect(source).toContain('100svh');
    expect(source).not.toContain('100dvh');
  });

  it('keeps the study theater as an honest product-derived proof', () => {
    const sceneSource = readFileSync(resolve(projectRoot, 'src/features/landing/LandingScenes.tsx'), 'utf8');
    const theaterStart = sceneSource.indexOf('export function StudyTheaterScene');
    const theaterEnd = sceneSource.indexOf('export function SystemBentoScene');
    const theaterSource = sceneSource.slice(theaterStart, theaterEnd);

    expect(theaterSource).not.toContain('<img');
    expect(theaterSource).toContain('StudyCardProof');
    const proofSource = readFileSync(resolve(projectRoot, 'src/components/flashcard/StudyCardProof.tsx'), 'utf8');
    expect(proofSource).toContain('data-study-card-proof');
    expect(proofSource).not.toMatch(/from ['"][^'"]*(Flashcard|StudyView|Firebase|Gemini|audio|dialog|session)/i);
  });
});
