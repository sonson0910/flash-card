import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Firestore rules source invariants', () => {
  it('routes shared-deck writes through App Check-protected callable functions', () => {
    const rules = readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8');
    const sharedDeckMatch = rules.match(
      /match \/shared_decks\/\{shareId\} \{([\s\S]*?)\n\s*\}/,
    )?.[1] ?? '';

    expect(sharedDeckMatch).toMatch(/allow list: if false/);
    expect(sharedDeckMatch).toMatch(/allow create, update, delete: if false/);
    expect(sharedDeckMatch).toMatch(/resource\.data\.expiresAt > request\.time/);
    expect(rules).not.toMatch(/isValidSharedCardMediaAt/);
  });

  it('uses an explicit card field allowlist including the v2 mutation protocol', () => {
    const rules = readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8');

    expect(rules).toMatch(/data\.keys\(\)\.hasOnly\(\[/);
    for (const field of [
      'schemaVersion',
      'revision',
      'libraryEpoch',
      'updatedAt',
      'lastOpenedAt',
      'sortTouchedAt',
    ]) {
      expect(rules).toContain(`'${field}'`);
    }
  });

  it('validates every bounded vocabulary list item as a short string', () => {
    const rules = readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8');
    const helper = rules.match(
      /function isValidBoundedStringList\(values\) \{([\s\S]*?)\n\s*\}/,
    )?.[1] ?? '';

    expect(helper).toMatch(/values is list/);
    expect(helper).toMatch(/values\.size\(\) <= 4/);
    for (const index of [0, 1, 2, 3]) {
      expect(helper).toContain(`values[${index}] is string`);
      expect(helper).toContain(`values[${index}].size() <= 100`);
    }
    for (const field of ['collocations', 'synonyms', 'antonyms']) {
      expect(rules).toContain(`isValidBoundedStringList(data.${field})`);
    }
  });

  it('binds v2 card writes to the owner library epoch', () => {
    const rules = readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8');
    const cardMatch = rules.match(
      /match \/users\/\{userId\}\/cards\/\{cardId\} \{([\s\S]*?)\n\s*\}/,
    )?.[1] ?? '';

    expect(rules).toContain('function isCurrentCardEpoch(userId, data)');
    expect(rules).toContain('/profile/library_state');
    expect(rules).toMatch(/data\.libraryEpoch == currentLibraryEpoch\(userId\)/);
    expect(cardMatch).toMatch(/isCurrentCardEpoch\(userId, request\.resource\.data\)/);
    expect(rules).toMatch(/profileDocId != 'library_state'/);
  });

  it('locks tombstones to owner point reads and current-epoch monotonic writes', () => {
    const rules = readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8');
    const tombstoneMatch = rules.match(
      /match \/users\/\{userId\}\/card_tombstones\/\{cardId\} \{([\s\S]*?)\n\s*\}/,
    )?.[1] ?? '';

    expect(tombstoneMatch).toMatch(/allow get: if isOwner\(userId\)/);
    expect(tombstoneMatch).toMatch(/allow list: if false/);
    expect(tombstoneMatch).toMatch(/isValidCardTombstone\(userId, cardId, request\.resource\.data\)/);
    expect(tombstoneMatch).toMatch(/allow delete: if false/);
  });

  it('keeps the multilingual catalog published-only and client read-only', () => {
    const rules = readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8');

    const lexemeMatch = rules.match(
      /match \/lexemes\/\{lexemeId\} \{([\s\S]*?)\n\s*\}/,
    )?.[1] ?? '';
    const membershipMatch = rules.match(
      /match \/track_memberships\/\{membershipId\} \{([\s\S]*?)\n\s*\}/,
    )?.[1] ?? '';

    expect(lexemeMatch).toMatch(/resource\.data\.schemaVersion == 3/);
    expect(lexemeMatch).toMatch(/resource\.data\.provenance\.editorialStatus == 'published'/);
    expect(membershipMatch).toMatch(/resource\.data\.schemaVersion == 3/);
    expect(membershipMatch).toMatch(/resource\.data\.editorialStatus == 'published'/);
    for (const matchBody of [lexemeMatch, membershipMatch]) {
      expect(matchBody).toMatch(/allow create, update, delete: if false/);
    }
  });

  it('keeps v3 learning state owner-readable but routes every mutation through trusted server code', () => {
    const rules = readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8');
    const learningStateMatch = rules.match(
      /match \/users\/\{userId\}\/learning_states\/\{lexemeId\} \{([\s\S]*?)\n\s*\}/,
    )?.[1] ?? '';

    expect(learningStateMatch).toMatch(/allow read: if isOwner\(userId\)/);
    expect(learningStateMatch).toMatch(/allow create, update, delete: if false/);
    expect(learningStateMatch).not.toMatch(/request\.resource/);
    expect(rules).not.toContain('function isValidLearningStateV3');
  });
});
