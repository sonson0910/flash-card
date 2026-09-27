import { describe, expect, it } from 'vitest';
import { legacyMigrationLanguageAndSourceFields } from '../src/legacyLibraryMigrationFirestore.js';

// `legacyMigrationLanguageAndSourceFields` is the pure field-carrying step
// `applyMigrationGroup` runs on the group's strongest source card after
// `planLegacyIdentityGroup` (functions/src/duplicateCleanup.ts) merges the
// rest of the card. It has no Firestore dependency, so it is covered here
// directly instead of only through the emulator-gated integration suite.
describe('legacyMigrationLanguageAndSourceFields', () => {
  it('carries a valid language, translationLanguage and source through unchanged', () => {
    const fields = legacyMigrationLanguageAndSourceFields({
      id: 'word-quite',
      language: 'ko',
      translationLanguage: 'vi',
      source: {
        url: 'https://example.com/article',
        title: 'Article title',
        context: 'surrounding sentence',
        capturedAt: '2026-09-01T00:00:00.000Z',
      },
    });

    expect(fields).toEqual({
      language: 'ko',
      translationLanguage: 'vi',
      source: {
        url: 'https://example.com/article',
        title: 'Article title',
        context: 'surrounding sentence',
        capturedAt: '2026-09-01T00:00:00.000Z',
      },
    });
  });

  it('defaults a missing language to en, matching backfill-card-language.mjs and canonicalCard', () => {
    const fields = legacyMigrationLanguageAndSourceFields({ id: 'word-quite' });

    expect(fields.language).toBe('en');
  });

  it('falls back to en for an invalid language code instead of writing a bad value', () => {
    const fields = legacyMigrationLanguageAndSourceFields({
      id: 'word-quite',
      language: 'not-a-real-code!',
    });

    expect(fields.language).toBe('en');
  });

  it('leaves translationLanguage absent when missing, matching canonicalCard (no invented default)', () => {
    const fields = legacyMigrationLanguageAndSourceFields({ id: 'word-quite' });

    expect(fields).not.toHaveProperty('translationLanguage');
  });

  it('drops an unsupported translationLanguage instead of writing it', () => {
    const fields = legacyMigrationLanguageAndSourceFields({
      id: 'word-quite',
      translationLanguage: 'fr',
    });

    expect(fields).not.toHaveProperty('translationLanguage');
  });

  it('leaves source absent when the card never had one', () => {
    const fields = legacyMigrationLanguageAndSourceFields({ id: 'word-quite' });

    expect(fields).not.toHaveProperty('source');
  });

  it('drops a malformed source instead of throwing and blocking the migration', () => {
    const fields = legacyMigrationLanguageAndSourceFields({
      id: 'word-quite',
      source: { url: 'javascript:alert(1)' },
    });

    expect(fields).not.toHaveProperty('source');
    expect(fields.language).toBe('en');
  });

  it('drops a source with an unsupported field instead of throwing', () => {
    const fields = legacyMigrationLanguageAndSourceFields({
      id: 'word-quite',
      source: { url: 'https://example.com', unexpectedField: 'nope' },
    });

    expect(fields).not.toHaveProperty('source');
  });
});
