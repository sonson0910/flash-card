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
  it('routes every shared-deck read and write through App Check-protected callable functions', () => {
    const rules = readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8');
    const sharedDeckMatch = extractRulesBlock(rules, 'match /shared_decks/{shareId}');
    const ownershipMatch = extractRulesBlock(rules, 'match /shared_deck_owners/{shareId}');

    expect(sharedDeckMatch).toMatch(/allow read: if false/);
    expect(sharedDeckMatch).toMatch(/allow create, update, delete: if false/);
    expect(ownershipMatch).toMatch(/allow read, write: if false/);
    expect(rules).not.toContain('function isValidPublicSharedDeck');
    expect(rules).not.toContain('function isValidPublicSharedCard');
    expect(rules).not.toContain('function hasOnlyPublicSharedCards');
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

    expect(rules).toContain('function isCurrentCardEpoch(userId, data)');
    expect(rules).toContain('/profile/library_state');
    expect(rules).toMatch(/data\.libraryEpoch == currentLibraryEpoch\(userId\)/);
    expect(cardMatch).toMatch(/canCreateCurrentCard\(userId, cardId, request\.resource\.data\)/);
    expect(cardMatch).toMatch(/canUpdateCurrentCard\(userId, request\.resource\.data\)/);
    expect(rules).toMatch(/profileDocId != 'library_state'/);
  });

  it('keeps strict enforcement canonical and isolates the one-way legacy bridge', () => {
    const strictRules = readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8');
    const compatibilityRules = readFileSync(
      new URL('./firestore.compatibility.rules', import.meta.url),
      'utf8',
    );
    const cardMatch = extractRulesBlock(
      compatibilityRules,
      'match /users/{userId}/cards/{cardId}',
    );
    const tombstoneMatch = extractRulesBlock(
      compatibilityRules,
      'match /users/{userId}/card_tombstones/{cardId}',
    );
    const stateSchema = extractRulesBlock(
      strictRules,
      'function isValidLibraryState(data)',
    );
    const unfencedStateSchema = extractRulesBlock(
      compatibilityRules,
      'function isValidUnfencedLibraryState(data)',
    );
    const legacyParticipation = extractRulesBlock(
      compatibilityRules,
      'function preservesUnfencedLibraryState(userId)',
    );
    const compatibilityParticipation = extractRulesBlock(
      compatibilityRules,
      'function hasValidMutationParticipation(userId)',
    );
    const strictParticipation = extractRulesBlock(
      strictRules,
      'function hasValidMutationParticipation(userId)',
    );
    const compatibilityStateMatch = extractRulesBlock(
      compatibilityRules,
      'match /users/{userId}/profile/library_state',
    );
    const strictStateMatch = extractRulesBlock(
      strictRules,
      'match /users/{userId}/profile/library_state',
    );
    const migrationMatch = extractRulesBlock(
      strictRules,
      'match /users/{userId}/profile/query_migration',
    );
    const genericProfileMatch = extractRulesBlock(
      strictRules,
      'match /users/{userId}/profile/{profileDocId}',
    );

    for (const rules of [strictRules, compatibilityRules]) {
      expect(rules).toContain('function currentMutationGeneration(userId)');
      expect(rules).toContain('function advancesMutationGeneration(userId)');
      expect(rules).toContain('getAfter(state).data.mutationGeneration');
      expect(rules).toContain('currentMutationGeneration(userId) + 1');
    }
    expect(new Set(stringListAfter(stateSchema, 'data.keys().hasAll('))).toEqual(new Set([
      'schemaVersion',
      'libraryEpoch',
      'mutationGeneration',
    ]));
    expect(new Set(stringListAfter(stateSchema, 'data.keys().hasOnly('))).toEqual(new Set([
      'schemaVersion',
      'libraryEpoch',
      'mutationGeneration',
    ]));
    expect(stateSchema).toMatch(/data\.mutationGeneration is int/);
    expect(strictRules).not.toContain('function isValidUnfencedLibraryState(data)');
    expect(strictRules).not.toContain('function preservesUnfencedLibraryState(userId)');
    expect(strictParticipation).toContain('return advancesMutationGeneration(userId);');
    expect(strictStateMatch).not.toContain('isValidUnfencedLibraryState');
    expect(new Set(stringListAfter(unfencedStateSchema, 'data.keys().hasAll('))).toEqual(new Set([
      'schemaVersion',
      'libraryEpoch',
    ]));
    expect(new Set(stringListAfter(unfencedStateSchema, 'data.keys().hasOnly('))).toEqual(new Set([
      'schemaVersion',
      'libraryEpoch',
    ]));
    expect(legacyParticipation).toContain('exists(state)');
    expect(legacyParticipation).toContain('existsAfter(state)');
    expect(legacyParticipation).toContain('isValidUnfencedLibraryState(get(state).data)');
    expect(legacyParticipation).toContain('isValidUnfencedLibraryState(getAfter(state).data)');
    expect(legacyParticipation).toMatch(
      /getAfter\(state\)\.data\.libraryEpoch == get\(state\)\.data\.libraryEpoch/,
    );
    expect(compatibilityParticipation).toContain('advancesMutationGeneration(userId)');
    expect(compatibilityParticipation).toContain('preservesUnfencedLibraryState(userId)');
    expect(cardMatch.match(/hasValidMutationParticipation\(userId\)/g)).toHaveLength(3);
    expect(cardMatch).toMatch(
      /isOldCardGeneration\(userId, resource\.data\)[\s\S]*hasValidDeletionBarrier[\s\S]*hasValidMutationParticipation/,
    );
    expect(tombstoneMatch.match(/hasValidMutationParticipation\(userId\)/g)).toHaveLength(2);
    expect(compatibilityStateMatch).toMatch(
      /request\.resource\.data\.mutationGeneration == currentMutationGeneration\(userId\) \+ 1/,
    );
    expect(compatibilityStateMatch).toMatch(
      /isValidUnfencedLibraryState\(resource\.data\)[\s\S]*isValidUnfencedLibraryState\(request\.resource\.data\)/,
    );
    expect(migrationMatch).toMatch(/allow read: if isOwner\(userId\)/);
    expect(migrationMatch).toMatch(/allow create, update, delete: if false/);
    expect(genericProfileMatch).toContain("profileDocId != 'library_state'");
    expect(genericProfileMatch).toContain("profileDocId != 'query_migration'");
  });

  it('schema-locks bounded gamification documents without a generic-profile bypass', () => {
    const rules = readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8');
    const statsSchema = extractRulesBlock(rules, 'function isValidGamificationStats(data)');
    const sequenceMapSchema = extractRulesBlock(
      rules,
      'function isValidAppliedXpSequenceByClient(sequences)',
    );
    const clientSequenceSchema = extractRulesBlock(
      rules,
      'function isValidAppliedXpClientSequence(clientId, sequence)',
    );
    const historySchema = extractRulesBlock(rules, 'function isValidGamificationHistory(data)');
    const statsMatch = extractRulesBlock(rules, 'match /users/{userId}/profile/stats');
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
      'appliedXpSequenceByClient',
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
    expect(statsSchema).toContain(
      'isValidAppliedXpSequenceByClient(data.appliedXpSequenceByClient)',
    );
    expect(sequenceMapSchema).toMatch(/sequences is map/);
    expect(sequenceMapSchema).toMatch(/sequences\.keys\(\)\.size\(\) <= 64/);
    expect(rules).toMatch(
      /function isValidXpClientId\(clientId\)[\s\S]*clientId is string[\s\S]*clientId\.size\(\) > 0[\s\S]*clientId\.size\(\) <= 64[\s\S]*clientId\.matches/,
    );
    expect(rules).toMatch(
      /function isValidAppliedXpSequence\(sequence\)[\s\S]*sequence is int[\s\S]*sequence > 0[\s\S]*sequence <= 9007199254740991/,
    );
    expect(clientSequenceSchema).toContain('isValidXpClientId(clientId)');
    expect(clientSequenceSchema).toContain('isValidAppliedXpSequence(sequence)');
    for (const index of Array.from({ length: 64 }, (_, value) => value)) {
      expect(sequenceMapSchema).toContain(
        `isValidAppliedXpClientSequence(sequences.keys()[${index}], sequences.values()[${index}])`,
      );
    }

    expect(historySchema).not.toBe('');
    expect(historySchema).toMatch(/data is map/);
    expect(historySchema).toMatch(/data\.keys\(\)\.size\(\) <= 730/);

    expect(statsMatch).toMatch(/allow read: if isOwner\(userId\)/);
    expect(statsMatch).toMatch(
      /allow create, update: if isOwner\(userId\)[\s\S]*isValidGamificationStats\(request\.resource\.data\)/,
    );
    expect(statsMatch).toMatch(/allow delete: if false/);
    expect(historyMatch).toMatch(/allow read: if isOwner\(userId\)/);
    expect(historyMatch).toMatch(
      /allow create, update: if isOwner\(userId\)[\s\S]*isValidGamificationHistory\(request\.resource\.data\)/,
    );
    expect(historyMatch).toMatch(/allow delete: if false/);

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

    expect(rules).toContain('function canCreateCurrentCard(userId, cardId, data)');
    expect(rules).toContain('function canUpdateCurrentCard(userId, data)');
    expect(rules).toContain('function hasValidDeletionBarrier(userId, cardId, data)');
    expect(rules).toContain('function isNewerTombstone(previous, next)');
    expect(rules).toMatch(/next\.libraryEpoch > previous\.libraryEpoch/);
    expect(rules).toMatch(
      /next\.libraryEpoch == previous\.libraryEpoch[\s\S]*next\.revision > previous\.revision/,
    );
    expect(rules).toMatch(/data\.revision == resource\.data\.revision \+ 1/);
    expect(rules).toMatch(/data\.revision == get\(tombstone\)\.data\.revision \+ 1/);
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
    const upgradeableLegacy = extractRulesBlock(
      rules,
      'function isUpgradeableLegacyCard(userId, data)',
    );

    expect(rules).toContain('function isUpgradeableLegacyCard(userId, data)');
    expect(rules).toContain('function isNextCardRevision(previous, nextRevision)');
    expect(upgradeableLegacy).toContain('currentLibraryEpoch(userId) == 0');
    expect(rules).toMatch(
      /function isCurrentProtocolCard[\s\S]*data\.keys\(\)\.hasAll\(\['schemaVersion', 'revision', 'libraryEpoch'\]\)/,
    );
    expect(rules).toMatch(
      /!data\.keys\(\)\.hasAny\(\['libraryEpoch'\]\)[\s\S]*data\.libraryEpoch == currentLibraryEpoch\(userId\)/,
    );
    expect(rules).toMatch(/!isCurrentProtocolCard\(userId, data\)/);
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
    expect(tombstoneMatch).toMatch(
      /allow create:[\s\S]*hasValidMutationParticipation\(userId\)/,
    );
    expect(tombstoneMatch).toMatch(
      /isNewerTombstone\(resource\.data, request\.resource\.data\)[\s\S]*hasValidMutationParticipation\(userId\)/,
    );
    expect(tombstoneMatch).toMatch(/\|\| request\.resource\.data == resource\.data/);
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

  it('requires immutable matching reservations before creating cards', () => {
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
    expect(rules).toContain('function hasMatchingCardReservation(userId, cardId, data)');
    expect(rules).toContain('function hasMatchingCardForReservation(userId, data)');
    expect(rules).toContain('let reservationId = cardReservationId(data.normalizedWord);');
    expect(rules).toContain('/card_reservations/$(reservationId)');
    expect(rules).toMatch(/reservationId == cardReservationId\(data\.normalizedWord\)/);
    expect(rules).toMatch(/existsAfter\(reservation\)/);
    expect(rules).toMatch(/getAfter\(reservation\)\.data\.cardId == cardId/);
    expect(rules).toMatch(
      /getAfter\(reservation\)\.data\.normalizedWord == data\.normalizedWord/,
    );
    expect(cardMatch).toMatch(
      /hasMatchingCardReservation\(userId, cardId, request\.resource\.data\)/,
    );
    expect(rules).toContain('function hasValidCardIdentityUpdate(userId, cardId, data)');
    expect(rules).toMatch(
      /resource\.data\.normalizedWord == data\.normalizedWord/,
    );
    expect(identityUpdate).toMatch(
      /hasCardIdentity\(resource\.data\)[\s\S]*resource\.data\.normalizedWord == data\.normalizedWord\s*&& resource\.data\.word == data\.word\s*&& \(/,
    );
    expect(identityUpdate).toMatch(
      /!hasCardIdentity\(resource\.data\)[\s\S]*resource\.data\.word is string[\s\S]*data\.word == resource\.data\.word[\s\S]*data\.normalizedWord == resource\.data\.word/,
    );
    expect(cardMatch).toMatch(
      /hasValidCardIdentityUpdate\(userId, cardId, request\.resource\.data\)/,
    );
    expect(reservationMatch).toMatch(/allow get: if isOwner\(userId\)/);
    expect(reservationMatch).toMatch(/allow list: if false/);
    expect(reservationMatch).toMatch(
      /allow create: if isOwner\(userId\)[\s\S]*isValidCardReservation/,
    );
    expect(reservationMatch).toMatch(/hasMatchingCardForReservation/);
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
