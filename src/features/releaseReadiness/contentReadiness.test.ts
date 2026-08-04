import { describe, expect, it } from 'vitest';
import { createEnglishPilotCatalog } from '../catalogPipeline/pilotCatalog';
import { assessContentReadiness } from './contentReadiness';

describe('Phase 6 content release gate', () => {
  it('blocks the AI-assisted pilot until rights and independent review evidence exist', async () => {
    const result = await assessContentReadiness(createEnglishPilotCatalog());
    expect(result.status).toBe('blocked');
    if (result.status !== 'blocked') throw new Error('Expected blocked content evidence.');
    expect(result.counts).toEqual({ lexemes: 300, memberships: 900 });
    expect(result.reasons).toEqual(expect.arrayContaining([
      'entity-not-published', 'provenance-not-publishable', 'rights-evidence-required', 'review-required',
    ]));
  });

  it('quarantines malformed input before editorial checks', async () => {
    await expect(assessContentReadiness({ manifest: {}, lexemes: [], memberships: [] }))
      .resolves.toMatchObject({ status: 'quarantined' });
  });
});
