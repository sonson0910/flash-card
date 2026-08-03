import { describe, expect, it } from 'vitest';
import { validateCatalogSourceBundle } from './catalogValidation';
import { createEnglishPilotCatalog } from './pilotCatalog';

const tracks = ['ielts', 'toeic', 'general'] as const;

describe('English pilot catalog', () => {
  it('creates exactly 300 ordered memberships for every supported track', () => {
    const pilot = createEnglishPilotCatalog();

    expect(pilot.memberships).toHaveLength(900);
    for (const trackId of tracks) {
      const memberships = pilot.memberships.filter(item => item.entity.trackId === trackId);
      expect(memberships).toHaveLength(300);
      expect(memberships.map(item => item.entity.rank)).toEqual(
        Array.from({ length: 300 }, (_, rank) => rank),
      );
      expect(memberships.slice(0, 100).every(item => item.entity.tier === 'foundation')).toBe(true);
      expect(memberships.slice(100, 200).every(item => item.entity.tier === 'core')).toBe(true);
      expect(memberships.slice(200).every(item => item.entity.tier === 'advanced')).toBe(true);
    }
  });

  it('uses unique stable identities and includes required learning material', () => {
    const pilot = createEnglishPilotCatalog();
    const lexemeIds = pilot.lexemes.map(item => item.entity.id);
    const membershipIds = pilot.memberships.map(item => item.entity.id);

    expect(new Set(lexemeIds).size).toBe(lexemeIds.length);
    expect(new Set(membershipIds).size).toBe(900);
    for (const candidate of pilot.lexemes) {
      expect(candidate.entity.definitions[0]).toMatchObject({ language: 'vi' });
      expect(candidate.entity.definitions[0]?.text.trim()).not.toBe('');
      expect(candidate.entity.examples[0]?.text).toContain(candidate.entity.lemma);
      expect(candidate.entity.examples[0]?.translations[0]).toMatchObject({ language: 'vi' });
      expect(candidate.entity.collocations.length).toBeGreaterThan(0);
    }
  });

  it('is deterministic and passes the strict pilot validator', () => {
    const first = createEnglishPilotCatalog();
    const second = createEnglishPilotCatalog();

    expect(second).toEqual(first);
    expect(validateCatalogSourceBundle(first, { requireEnglishPilotCounts: true }))
      .toMatchObject({ status: 'accepted' });
  });

  it('keeps every generated candidate unreviewed, draft and non-publishable', () => {
    const pilot = createEnglishPilotCatalog();

    for (const candidate of [...pilot.lexemes, ...pilot.memberships]) {
      expect(candidate.provenance).toMatchObject({
        sourceRef: 'internal-phase3-pilot',
        sourceUrl: null,
        licenseId: 'NOASSERTION',
        rightsEvidenceId: null,
        authorId: 'codex-phase3-generator',
        origin: 'ai-assisted',
        publishability: 'non-publishable',
      });
      expect(candidate.review).toEqual({ status: 'unreviewed' });
    }
    expect(pilot.lexemes.every(candidate => candidate.entity.provenance.editorialStatus === 'draft'))
      .toBe(true);
    expect(pilot.memberships.every(candidate => candidate.entity.editorialStatus === 'draft'))
      .toBe(true);
  });
});
