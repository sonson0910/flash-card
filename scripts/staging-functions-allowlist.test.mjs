import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'vitest';

const scripts = JSON.parse(fs.readFileSync('package.json', 'utf8')).scripts;

function selectedFunctions(scriptName) {
  const command = scripts[scriptName];
  const targets = /--only (\S+) --non-interactive$/.exec(command)?.[1];
  assert.ok(targets, `${scriptName} must deploy an explicit --only list`);
  const names = targets.split(',').map(target => {
    assert.match(target, /^functions:[A-Za-z][A-Za-z0-9]*$/);
    return target.slice('functions:'.length);
  });
  assert.equal(new Set(names).size, names.length, `${scriptName} has duplicate targets`);
  return names.sort();
}

describe('staging Functions deployment', () => {
  it('verifies the required index before either Functions allowlist', () => {
    assert.match(scripts['staging:deploy:functions'],
      /^npm run staging:verify:indexes && npm run staging:deploy:functions:existing && npm run staging:deploy:functions:pilot$/);
    assert.match(scripts['staging:deploy:functions:pilot'], /^npm run staging:verify:indexes && /);
  });
  it('retains the existing endpoints and includes every pilot endpoint', () => {
    const existing = selectedFunctions('staging:deploy:functions:existing');
    const pilot = selectedFunctions('staging:deploy:functions:pilot');
    assert.deepEqual(existing, [
      'generateVocabulary', 'createCard', 'createCardV2', 'findVocabularyImage',
      'reviewCard', 'reviewCardV2', 'startPracticeSessionV1', 'completePracticeSessionV1',
      'equipOwnedFrame', 'saveGamification', 'updateLibraryFacets',
      'createSharedDeck', 'createSharedDeckV2', 'revokeSharedDeck',
    ].sort());
    assert.deepEqual(pilot, [
      'migrateLegacyLibrary', 'sweepAiOperations', 'cancelCardGeneration',
      'askCardTutor', 'reportCard', 'getPilotOffer', 'recordClientEvents',
      'exportMyData', 'deleteMyAccount', 'finalizeAccountDeletions',
      'recordPurchaseIntent', 'updateReminderSettings', 'revokePushToken', 'endPushSession',
      'sweepPushReminders', 'sweepWeeklyDigests',
      'createStarterCards', 'renameCardHeadword', 'bulkMutateCards', 'clearLibraryCardsPage',
      'createCourse', 'updateCourse', 'archiveCourse', 'reopenCourse', 'setActiveCourse',
      'addGoal', 'updateGoal', 'removeGoal',
    ].sort());
    const indexSource = fs.readFileSync('functions/src/index.ts', 'utf8');
    const exportedEndpoints = Array.from(
      indexSource.matchAll(/export const ([A-Za-z][A-Za-z0-9]*)\s*=\s*(?:onCall|onSchedule|onRequest|courseProfileCallable)\(/g),
      match => match[1],
    ).sort();
    assert.deepEqual([...existing, ...pilot].sort(), exportedEndpoints);
  });
});
