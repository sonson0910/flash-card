import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const extractRulesBlock = (source: string, declaration: string): string => {
  const declarationIndex = source.indexOf(declaration);
  if (declarationIndex < 0) return '';
  const openingBraceIndex = source.indexOf('{', declarationIndex + declaration.length);
  if (openingBraceIndex < 0) return '';

  let depth = 0;
  for (let index = openingBraceIndex; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] !== '}') continue;
    depth -= 1;
    if (depth === 0) return source.slice(openingBraceIndex + 1, index);
  }
  return '';
};

const stringListAfter = (source: string, marker: string): string[] => {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return [];
  const openingBracketIndex = source.indexOf('[', markerIndex + marker.length);
  const closingBracketIndex = source.indexOf(']', openingBracketIndex + 1);
  if (openingBracketIndex < 0 || closingBracketIndex < 0) return [];
  return Array.from(
    source.slice(openingBracketIndex + 1, closingBracketIndex).matchAll(/'([^']+)'/g),
    match => match[1],
  );
};

describe('Firestore rules source invariants', () => {
  it('exempts unqueried migration payloads from index amplification without weakening owner queries', () => {
    const indexes = JSON.parse(readFileSync(new URL('./firestore.indexes.json', import.meta.url), 'utf8')) as {
      fieldOverrides: { collectionGroup: string; fieldPath: string; indexes: unknown[] }[];
    };
    const overrides = new Set(indexes.fieldOverrides.map(override => `${override.collectionGroup}:${override.fieldPath}`));
    for (const field of [
      'shared_decks:cards',
      'admin_shared_deck_migration_quarantine:publicData',
      'admin_shared_deck_migration_quarantine:privateData',
      'sealed_manifest_chunks:entries',
    ]) expect(overrides.has(field)).toBe(true);
    expect(overrides.has('shared_deck_owners:ownerUid')).toBe(false);
  });

  it('keeps library facet writes server-only while preserving owner reads', () => {
    const rules = readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8');
    const facetsMatch = rules.match(
      /match \/users\/\{userId\}\/profile\/library_facets \{([\s\S]*?)\n\s*\}/,
    )?.[1] ?? '';

    expect(facetsMatch).toContain('allow read: if isOwner(userId);');
    expect(facetsMatch).toContain('allow create, update, delete: if false;');
    expect(facetsMatch).not.toContain('isValidLibraryFacetsProfile');
  });

  it('routes shared-deck writes through App Check-protected callable functions', () => {
    const rules = readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8');
    const sharedDeckMatch = rules.match(
      /match \/shared_decks\/\{shareId\} \{([\s\S]*?)\n\s*\}/,
    )?.[1] ?? '';

    expect(sharedDeckMatch).toMatch(/allow list: if false/);
    expect(sharedDeckMatch).toMatch(/allow create, update, delete: if false/);
    expect(sharedDeckMatch).toMatch(/resource\.data\.expiresAt > request\.time/);
    expect(rules).not.toMatch(/isValidSharedCardMediaAt/);

    const ownershipMatch = rules.match(
      /match \/shared_deck_owners\/\{shareId\} \{([\s\S]*?)\n\s*\}/,
    )?.[1] ?? '';
    expect(ownershipMatch).toMatch(/allow read, write: if false/);
  });

  it('removes legacy public shared-deck read helpers after cutover', () => {
    const rules = readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8');
    const sharedDeckMatch = extractRulesBlock(rules, 'match /shared_decks/{shareId}');
    expect(rules).not.toContain('isValidLegacyPublicSharedDeck');
    expect(rules).not.toContain('isValidTransitionalCallableSharedDeck');
    expect(sharedDeckMatch).toContain('isValidCurrentPublicSharedDeck(resource.data)');
    expect(sharedDeckMatch).toContain('resource.data.expiresAt > request.time');
    expect(sharedDeckMatch).toContain('!isSharedDeckQuarantined(shareId)');
    expect(rules).toContain('admin_shared_deck_migration_quarantine/$(shareId)');
  });

  it('keeps public schema 2 owner-free and expiring', () => {
    const rules = readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8');
    const currentSchema = extractRulesBlock(rules, 'function isValidCurrentPublicSharedDeck(data)');
    expect(new Set(stringListAfter(currentSchema, 'data.keys().hasAll(')))
      .toEqual(new Set(['category', 'cards', 'createdAt', 'expiresAt', 'schemaVersion']));
    expect(new Set(stringListAfter(currentSchema, 'data.keys().hasOnly(')))
      .toEqual(new Set(['category', 'cards', 'createdAt', 'expiresAt', 'schemaVersion']));
    expect(currentSchema).toContain('data.schemaVersion == 2');
    expect(currentSchema).not.toContain('authorUid');
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
      'mnemonic',
      'wordFamily',
    ]) {
      expect(rules).toContain(`'${field}'`);
    }
  });

  it('validates every bounded vocabulary list item as a short string', () => {
    const rules = readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8');
    const helper = rules.match(
      /function isValidBoundedStringList\(values\) \{([\s\S]*?)\n\s*\}/,
    )?.[1] ?? '';

    expect(helper).toContain('let valueCount = values.size();');
    expect(helper.match(/values\.size\(\)/g)).toHaveLength(1);
    expect(helper).toMatch(/values is list/);
    expect(helper).toMatch(/valueCount <= 4/);
    for (const index of [0, 1, 2, 3]) {
      expect(helper).toContain(`valueCount < ${index + 1}`);
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

    expect(rules).toContain('function isValidProtocolCounter(value)');
    expect(rules).toContain('/profile/library_state');
    expect(rules).toMatch(/data\.libraryEpoch == currentLibraryEpoch\(userId\)/);
    expect(cardMatch).toMatch(/allow create: if false/);
    expect(cardMatch).toMatch(/canUpdateCurrentCard\(userId, request\.resource\.data\)/);
    expect(rules).toMatch(/profileDocId != 'library_state'/);
  });

  it('schema-locks bounded gamification documents without a generic-profile bypass', () => {
    const rules = readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8');
    const statsSchema = extractRulesBlock(rules, 'function isValidGamificationStats(data)');
    const clientSequenceSchema = extractRulesBlock(
      rules,
      'function isValidAppliedXpClientSequence(clientId, sequence)',
    );
    const streamSchema = extractRulesBlock(rules, 'function isValidXpStreamDocument(clientId, data)');
    const historySchema = extractRulesBlock(rules, 'function isValidGamificationHistory(data)');
    const statsMatch = extractRulesBlock(rules, 'match /users/{userId}/profile/stats');
    const streamMatch = extractRulesBlock(rules, 'match /users/{userId}/xp_streams/{clientId}');
    const historyMatch = extractRulesBlock(rules, 'match /users/{userId}/profile/xp_history');
    const genericProfileMatch = extractRulesBlock(
      rules,
      'match /users/{userId}/profile/{profileDocId}',
    );
    const requiredStatsFields = stringListAfter(statsSchema, 'data.keys().hasAll(');
    const allowedStatsFields = stringListAfter(statsSchema, 'data.keys().hasOnly(');

    expect(new Set(requiredStatsFields)).toEqual(new Set([
      'streak',
      'xp',
      'lastActive',
      'appliedXpOperationIds',
      'xpStreamSchemaVersion',
    ]));
    expect(new Set(allowedStatsFields)).toEqual(new Set(requiredStatsFields));
    expect(statsSchema).toMatch(/data\.streak is int/);
    expect(statsSchema).toMatch(/data\.streak >= 0/);
    expect(statsSchema).toMatch(/data\.streak <= 9007199254740991/);
    expect(statsSchema).toMatch(/data\.xp is int/);
    expect(statsSchema).toMatch(/data\.xp >= 0/);
    expect(statsSchema).toMatch(/data\.xp <= 9007199254740991/);
    expect(statsSchema).toMatch(/data\.lastActive == null/);
    expect(statsSchema).toMatch(/data\.lastActive is string/);
    expect(statsSchema).toMatch(/data\.lastActive\.size\(\) <= 64/);
    expect(statsSchema).toMatch(/data\.appliedXpOperationIds is list/);
    expect(statsSchema).toMatch(/data\.appliedXpOperationIds\.size\(\) <= 2048/);
    expect(rules).toMatch(
      /function isValidXpClientId\(clientId\)[\s\S]*clientId\.matches\('\^\[A-Za-z0-9\]\[A-Za-z0-9_-\]\{0,63\}\$'\)[\s\S]*clientId != '__proto__'[\s\S]*clientId != 'constructor'[\s\S]*clientId != 'prototype'/,
    );
    expect(rules).toMatch(
      /function isValidAppliedXpSequence\(sequence\)[\s\S]*sequence is int[\s\S]*sequence > 0[\s\S]*sequence <= 9007199254740991/,
    );
    expect(clientSequenceSchema).toContain('isValidXpClientId(clientId)');
    expect(clientSequenceSchema).toContain('isValidAppliedXpSequence(sequence)');
    expect(statsSchema).toContain('data.xpStreamSchemaVersion == 2');
    expect(streamSchema).toContain("data.keys().hasAll(['schemaVersion', 'clientId', 'sequence', 'retiredAt'])");
    expect(streamSchema).toContain('data.clientId == clientId');
    expect(streamSchema).toContain('isValidAppliedXpClientSequence(clientId, data.sequence)');

    expect(historySchema).not.toBe('');
    expect(historySchema).toMatch(/data is map/);
    expect(historySchema).toMatch(/data\.keys\(\)\.size\(\) <= 730/);

    expect(statsMatch).toMatch(/allow read: if isOwner\(userId\)/);
    expect(statsMatch).toMatch(/allow create, update, delete: if false/);
    expect(streamMatch).toMatch(/allow read: if isOwner\(userId\)/);
    expect(streamMatch).toMatch(/allow create, update, delete: if false/);
    expect(historyMatch).toMatch(/allow read: if isOwner\(userId\)/);
    expect(historyMatch).toMatch(/allow create, update, delete: if false/);

    // Firestore ORs overlapping match permissions, so these exclusions are
    // security-critical rather than merely organizational.
    expect(genericProfileMatch).toContain("profileDocId != 'library_state'");
    expect(genericProfileMatch).toContain("profileDocId != 'stats'");
    expect(genericProfileMatch).toContain("profileDocId != 'xp_history'");
  });

  it('enforces revisioned creates, monotonic updates and tombstone-backed deletes', () => {
    const rules = readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8');
    const cardMatch = rules.match(
      /match \/users\/\{userId\}\/cards\/\{cardId\} \{([\s\S]*?)\n\s*\}/,
    )?.[1] ?? '';

    expect(rules).toContain('function isNextCardRevision(previous, nextRevision)');
    expect(rules).toContain('function canUpdateCurrentCard(userId, data)');
    expect(rules).toContain('function hasValidDeletionBarrier(userId, cardId, data)');
    expect(rules).toContain('function isNewerTombstone(previous, next)');
    expect(rules).toMatch(/next\.libraryEpoch > previous\.libraryEpoch/);
    expect(rules).toMatch(
      /next\.libraryEpoch == previous\.libraryEpoch[\s\S]*next\.revision > previous\.revision/,
    );
    expect(rules).toMatch(/isNextCardRevision\(resource\.data, data\.revision\)/);
    expect(rules).toMatch(/getAfter\(tombstone\)\.data\.revision == data\.revision \+ 1/);
    expect(rules).toMatch(/existsAfter\(tombstone\)/);
    expect(rules).toMatch(
      /isNewerTombstone\(get\(tombstone\)\.data, getAfter\(tombstone\)\.data\)/,
    );
    expect(cardMatch).toMatch(/allow create:/);
    expect(cardMatch).toMatch(/allow update:/);
    expect(cardMatch).toMatch(/allow delete:/);
    expect(cardMatch).not.toMatch(/allow create, update/);
    expect(cardMatch).not.toMatch(/allow delete: if isOwner\(userId\);/);
  });

  it('upgrades incomplete current-generation cards without allowing old generations back in', () => {
    const rules = readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8');
    expect(rules).toContain('function isNextCardRevision(previous, nextRevision)');
    expect(rules).toMatch(
      /function isCurrentProtocolCard[\s\S]*data\.keys\(\)\.hasAll\(\['schemaVersion', 'revision', 'libraryEpoch'\]\)/,
    );
    expect(rules).toMatch(
      /!data\.keys\(\)\.hasAny\(\['libraryEpoch'\]\)[\s\S]*data\.libraryEpoch == currentLibraryEpoch\(userId\)/,
    );
    expect(rules).toMatch(/currentLibraryEpoch\(userId\) == 0/);
    expect(rules).toMatch(/nextRevision == previous\.revision \+ 1/);
    expect(rules).toMatch(/nextRevision == 1/);
    expect(rules).toMatch(
      /function isLegacyCard\(data\)[\s\S]*!data\.keys\(\)\.hasAny\(\['libraryEpoch'\]\)/,
    );
    expect(rules).toMatch(
      /data\.keys\(\)\.hasAny\(\['revision'\]\)[\s\S]*getAfter\(tombstone\)\.data\.revision == data\.revision \+ 1/,
    );
  });

  it('locks tombstones to owner point reads and current-epoch monotonic writes', () => {
    const rules = readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8');
    const tombstoneMatch = rules.match(
      /match \/users\/\{userId\}\/card_tombstones\/\{cardId\} \{([\s\S]*?)\n\s*\}/,
    )?.[1] ?? '';

    expect(tombstoneMatch).toMatch(/allow get: if isOwner\(userId\)/);
    expect(tombstoneMatch).toMatch(/allow list: if false/);
    expect(tombstoneMatch).toMatch(/isValidCardTombstone\(userId, cardId, request\.resource\.data\)/);
    expect(tombstoneMatch).toMatch(/!existsAfter\(/);
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

  it('requires immutable matching reservations for legacy identity repair', () => {
    const rules = readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8');
    const cardMatch = extractRulesBlock(rules, 'match /users/{userId}/cards/{cardId}');
    const identityUpdate = extractRulesBlock(
      rules,
      'function hasValidCardIdentityUpdate(userId, cardId, data)',
    );
    const reservationMatch = extractRulesBlock(
      rules,
      'match /users/{userId}/card_reservations/{reservationId}',
    );

    expect(rules).toContain('function cardReservationId(normalizedWord)');
    expect(rules).toContain(
      'hashing.sha256(normalizedWord).toHexString().lower()',
    );
    expect(rules).toContain('function isValidCardReservation(reservationId, data)');
    expect(rules).toMatch(/isValidId\(data\.cardId\)/);
    expect(rules).toMatch(/data\.normalizedWord\.size\(\) <= 256/);
    expect(rules).toContain('function hasMatchingCardReservation(userId, cardId, data)');
    expect(rules).toContain('let reservationId = cardReservationId(data.normalizedWord);');
    expect(rules).toContain('/card_reservations/$(reservationId)');
    expect(rules).toContain('let reservationData = getAfter(reservation).data;');
    expect(rules).toMatch(/reservationId == cardReservationId\(data\.normalizedWord\)/);
    expect(rules).toMatch(/existsAfter\(reservation\)/);
    expect(rules).toMatch(/reservationData\.schemaVersion == 1/);
    expect(rules).toMatch(/reservationData\.cardId == cardId/);
    expect(rules).toMatch(
      /reservationData\.normalizedWord == data\.normalizedWord/,
    );
    expect(identityUpdate).toMatch(
      /hasMatchingCardReservation\(userId, cardId, data\)/,
    );
    expect(rules).toContain('function hasValidCardIdentityUpdate(userId, cardId, data)');
    expect(rules).toMatch(
      /resource\.data\.normalizedWord == data\.normalizedWord/,
    );
    expect(identityUpdate).toMatch(
      /hasCardIdentity\(resource\.data\)[\s\S]*resource\.data\.normalizedWord == data\.normalizedWord\s*&& resource\.data\.word == data\.word\s*&& \(/,
    );
    expect(identityUpdate).toMatch(
      /!hasCardIdentity\(resource\.data\)[\s\S]*resource\.data\.word is string[\s\S]*data\.word == resource\.data\.word[\s\S]*data\.normalizedWord == resource\.data\.word\.lower\(\)/,
    );
    expect(cardMatch).toMatch(
      /hasValidCardIdentityUpdate\(userId, cardId, request\.resource\.data\)/,
    );
    expect(reservationMatch).toMatch(/allow get: if isOwner\(userId\)/);
    expect(reservationMatch).toMatch(/allow list: if false/);
    expect(reservationMatch).toMatch(
      /allow create: if isOwner\(userId\)[\s\S]*isValidCardReservation/,
    );
    expect(reservationMatch).toMatch(/hasExistingCardForIdentityRepair/);
    expect(reservationMatch).toMatch(/allow update, delete: if false/);
  });

  it('keeps catalog candidates, revisions and editorial audit records server-only', () => {
    const rules = readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8');

    for (const path of [
      'catalog_candidates/{candidateId}',
      'catalog_revisions/{revisionId}',
      'catalog_audit/{eventId}',
    ]) {
      const escapedPath = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = rules.match(new RegExp(
        `match /${escapedPath} \\{([\\s\\S]*?)\\n\\s*\\}`,
      ))?.[1] ?? '';
      expect(match).toMatch(/allow read, write: if false/);
    }
  });
});
