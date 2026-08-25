import fs from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const nodeExpect = actual => ({
  toBe: expected => assert.equal(actual, expected),
  toBeGreaterThan: expected => assert.ok(actual > expected),
  toBeLessThan: expected => assert.ok(actual < expected),
  toContain: expected => assert.ok(actual.includes(expected)),
  toHaveLength: expected => assert.equal(actual.length, expected),
  toMatch: expected => assert.match(actual, expected),
  not: {
    toContain: expected => assert.ok(!actual.includes(expected)),
    toMatch: expected => assert.doesNotMatch(actual, expected),
  },
});

const { describe, expect, it } = process.env.VITEST
  ? await import('vitest')
  : { ...(await import('node:test')), expect: nodeExpect };

const read = relativePath => fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');

describe('release workflow contracts', () => {
  it('gates protected workflows on an exact revision reachable from the protected default branch', () => {
    for (const relativePath of [
      '.github/workflows/release-candidate.yml',
      '.github/workflows/deploy-production.yml',
      '.github/workflows/deploy-firestore-rules.yml',
      '.github/workflows/repair-legacy-libraries.yml',
    ]) {
      const workflow = read(relativePath);
      expect(workflow).toContain('DEFAULT_BRANCH: ${{ github.event.repository.default_branch }}');
      expect(workflow).toContain('git fetch --no-tags origin "refs/heads/$DEFAULT_BRANCH:refs/remotes/origin/$DEFAULT_BRANCH"');
      expect(workflow).toContain('git merge-base --is-ancestor "$REVISION" "origin/$DEFAULT_BRANCH"');
      expect(workflow).toContain('test "$(git rev-parse HEAD)" = "$REVISION"');
      expect(workflow).toContain('test "$GITHUB_REF" = "refs/heads/$DEFAULT_BRANCH"');
      expect(workflow).toContain('fetch-depth: 0');
    }
    for (const relativePath of [
      '.github/workflows/release-candidate.yml',
      '.github/workflows/repair-legacy-libraries.yml',
    ]) expect(read(relativePath)).toContain('test "$GITHUB_SHA" = "$REVISION"');
  });

  it('allows rollback-capable deploys to select an older sealed default-branch ancestor', () => {
    for (const relativePath of [
      '.github/workflows/deploy-production.yml',
      '.github/workflows/deploy-firestore-rules.yml',
    ]) {
      const workflow = read(relativePath);
      expect(workflow).not.toContain('test "$GITHUB_SHA" = "$REVISION"');
      expect(workflow).toContain('test "$GITHUB_REF" = "refs/heads/$DEFAULT_BRANCH"');
      expect(workflow).toContain('git merge-base --is-ancestor "$REVISION" "origin/$DEFAULT_BRANCH"');
      expect(workflow).toContain('test "$(git rev-parse HEAD)" = "$REVISION"');
    }
  });

  it('keeps the release candidate revision gate uncredentialed and before the protected build', () => {
    const workflow = read('.github/workflows/release-candidate.yml');
    const gate = workflow.slice(workflow.indexOf('  validate_revision:'), workflow.indexOf('  build:'));
    expect(workflow).toContain('revision:');
    expect(workflow).toContain('test "$GITHUB_SHA" = "$REVISION"');
    expect(workflow).toContain('needs: validate_revision');
    expect(workflow).toContain('environment: production');
    expect(gate).not.toContain('secrets.');
    expect(gate).not.toContain('environment:');
  });

  it('uploads the exact release build verified by the candidate workflow', () => {
    const workflow = read('.github/workflows/release-candidate.yml');
    const functionsPackage = JSON.parse(read('functions/package.json'));
    expect(workflow).toContain('npm run verify:release-config');
    expect(workflow).toContain('npm run verify');
    expect(workflow).toContain('release-artifact.mjs seal');
    expect(workflow).toContain('--revision "${{ inputs.revision }}"');
    expect(workflow).not.toContain('--revision "${{ github.sha }}"');
    expect(workflow).toContain('artifacts/release-candidate-manifest.json');
    expect(workflow).not.toContain('npm run build:release');
    expect(functionsPackage.scripts.preinstall).not.toMatch(/\.\.[/\\]/);
  });

  it('seals the pinned root Firebase CLI dependency tree and uses only the verified local binary', () => {
    const packageJson = JSON.parse(read('package.json'));
    const packageLock = JSON.parse(read('package-lock.json'));
    expect(packageJson.devDependencies['firebase-tools']).toBe('15.23.0');
    expect(packageLock.packages[''].devDependencies['firebase-tools']).toBe('15.23.0');
    expect(packageLock.packages['node_modules/firebase-tools'].version).toBe('15.23.0');

    const releaseWorkflow = read('.github/workflows/release-candidate.yml');
    expect(releaseWorkflow).toContain('package.json');
    expect(releaseWorkflow).toContain('package-lock.json');

    for (const [relativePath, jobNames] of [
      ['.github/workflows/deploy-production.yml', ['deploy_hosting:', 'deploy_functions:']],
      ['.github/workflows/deploy-firestore-rules.yml', ['deploy_rules:']],
    ]) {
      const workflow = read(relativePath);
      for (const jobName of jobNames) {
        const start = workflow.indexOf(`  ${jobName}`);
        const end = jobName === 'deploy_hosting:' ? workflow.indexOf('  deploy_functions:') : workflow.length;
        const job = workflow.slice(start, end);
        const install = job.indexOf('npm ci --ignore-scripts --no-audit --no-fund');
        const version = job.indexOf('test "$(./node_modules/.bin/firebase --version)" = "15.23.0"');
        const auth = job.indexOf('google-github-actions/auth@');
        expect(install).toBeGreaterThan(-1);
        expect(version).toBeGreaterThan(install);
        expect(auth).toBeGreaterThan(version);
        expect(job).toContain('./node_modules/.bin/firebase deploy');
        expect(job).not.toContain('npx --yes firebase-tools');
      }
    }
  });

  it('promotes a sealed candidate through explicit Hosting and Functions stages only', () => {
    const workflow = read('.github/workflows/deploy-production.yml');
    const validateJob = workflow.slice(workflow.indexOf('  validate_candidate:'), workflow.indexOf('  deploy_hosting:'));
    const hostingJob = workflow.slice(workflow.indexOf('  deploy_hosting:'), workflow.indexOf('  deploy_functions:'));
    const functionsJob = workflow.slice(workflow.indexOf('  deploy_functions:'));
    expect(workflow).toContain('candidate_run_id:');
    expect(workflow).toContain('candidate_sha256:');
    expect(workflow).toContain('actions: read');
    expect(workflow).toContain('actions/download-artifact@');
    expect(workflow).toContain('release-artifact.mjs verify');
    expect(workflow.match(/--workflow-run-id "\$\{\{ inputs\.candidate_run_id \}\}"/g) ?? []).toHaveLength(3);
    expect(workflow.match(/--project-id "\$FIREBASE_PROJECT_ID" --database-id "\$FIRESTORE_DATABASE_ID"/g) ?? []).toHaveLength(2);
    expect(workflow).toContain('test "$run_path" = ".github/workflows/release-candidate.yml"');
    expect(workflow).toContain('--only hosting');
    expect(workflow).toContain('--only functions');
    expect(validateJob).not.toContain('release-artifact.mjs promote-config');
    expect(hostingJob).toContain('release-artifact.mjs promote-config');
    expect(functionsJob).toContain('release-artifact.mjs promote-config');
    expect(functionsJob).toContain('npm ci --prefix candidate/functions --omit=dev --ignore-scripts --no-audit --no-fund');
    expect(functionsJob.indexOf('npm ci --prefix candidate/functions')).toBeLessThan(
      functionsJob.indexOf('./node_modules/.bin/firebase deploy --only functions'),
    );
    expect(workflow.match(/firebase_project_pattern='\^\[a-z\]\[a-z0-9-\]\{4,28\}\[a-z0-9\]\$'/g)).toHaveLength(2);
    expect(workflow).not.toMatch(/firebase-tools@[^\n]+ deploy --non-interactive\s*$/m);
    expect(workflow).not.toContain('--only firestore');
  });

  it('deploys Firestore Rules from only a sealed candidate behind protected approval', () => {
    const workflow = read('.github/workflows/deploy-firestore-rules.yml');
    expect(workflow).toContain("environment: ${{ inputs.operation == 'cutover' && 'production-rules-cutover' || 'production-rules-rollback' }}");
    expect(workflow).toContain('operation:');
    expect(workflow).toContain('approval_ref:');
    expect(workflow).toContain('migration_run_id:');
    expect(workflow).toContain('migration_report_sha256:');
    expect(workflow).toContain('migrate-legacy-shared-decks.yml');
    expect(workflow).toContain('legacy-shared-deck-report-${{ inputs.revision }}');
    expect(workflow).toContain('sha256sum "$report"');
    expect(workflow).toContain('.schemaVersion == 2');
    expect(workflow).toContain('.verified == true');
    expect(workflow).toContain('.inventoryDigest');
    expect(workflow).toContain('MIGRATION_OWNER_KEY');
    expect(workflow).toContain('--workflow-run-id "${{ inputs.candidate_run_id }}"');
    expect(workflow).toContain('--project-id "$FIREBASE_PROJECT_ID" --database-id "$FIRESTORE_DATABASE_ID"');
    expect(workflow).toContain('test "$candidate_path" = ".github/workflows/release-candidate.yml"');
    expect(workflow).toContain('test "$(jq -r \'.event\' <<<"$candidate_json")" = "workflow_dispatch"');
    expect(workflow).toContain("firebase_project_pattern='^[a-z][a-z0-9-]{4,28}[a-z0-9]$'");
    expect(workflow).toContain("firestore_database_pattern='^(\\(default\\)|[a-z][a-z0-9-]{2,61}[a-z0-9])$'");
    expect(workflow).toContain('promote-config --root validated --source firebase.json --output firebase.promoted.json --database-id "$FIRESTORE_DATABASE_ID"');
    expect(workflow).toContain('--only firestore:rules');
    expect(workflow).not.toMatch(/kms|migration[_-]evidence|rollback-snapshot/i);
    expect(workflow).not.toMatch(/--only firestore(?:\s|$)/);
    expect(workflow).not.toMatch(/firebase-tools@[^\n]+ deploy --non-interactive\s*$/m);
  });

  it('does not retain the completed reservation migration workflow', () => {
    expect(fs.existsSync(new URL('../.github/workflows/reservation-migration.yml', import.meta.url))).toBe(false);
  });

  it('does not document a local production deploy bypass', () => {
    const readme = read('README.md');
    expect(readme).not.toContain('npx firebase-tools login');
    expect(readme).not.toMatch(/npx firebase-tools deploy\s*$/m);
  });

  it('requires the fenced query-v3 revision before a repair workflow can mutate', () => {
    const workflow = read('.github/workflows/repair-legacy-libraries.yml');
    expect(workflow).toContain('APPLY_QUERY_V3');
    expect(workflow).toContain('ROLLBACK_QUERY_V3');
    expect(workflow).toContain('source_revision:');
    expect(workflow).toContain('MIGRATION_SOURCE_REVISION');
    expect(workflow).toMatch(/MIGRATION_SOURCE_REVISION.*\^\[a-f0-9\]\{64\}\$/s);
    expect(workflow).not.toContain('QUERY_V2');
    expect(workflow).toContain('environment: production-legacy-library-${{ inputs.mode }}');
    expect(workflow).not.toContain('environment: production-hosting');
  });

  it('runs repair only from a verified immutable release candidate', () => {
    const workflow = read('.github/workflows/repair-legacy-libraries.yml');
    expect(workflow).toContain('revision:');
    expect(workflow).toContain('candidate_run_id:');
    expect(workflow).toContain('candidate_sha256:');
    expect(workflow).toContain('permissions:\n  actions: read\n  contents: read');
    expect(workflow).toContain('test "$run_path" = ".github/workflows/release-candidate.yml"');
    expect(workflow).toContain('release-artifact.mjs verify');
    expect(workflow).toContain('candidate/functions/lib/legacyLibraryMigrationOperator.js');
    expect(workflow).toContain('validated-candidate-');
    expect(workflow).toContain('github-token: ${{ github.token }}');
    const authIndex = workflow.indexOf('google-github-actions/auth@');
    expect(authIndex).toBeGreaterThan(-1);
    expect(workflow.indexOf('MIGRATION_REVISION" =~ ^([0-9a-f]{40}|[0-9a-f]{64})$')).toBeLessThan(authIndex);
    expect(workflow.indexOf('MIGRATION_CANDIDATE_RUN_ID" =~ ^[1-9][0-9]{0,19}$')).toBeLessThan(authIndex);
    expect(workflow.indexOf('MIGRATION_CANDIDATE_SHA256" =~ ^[0-9a-f]{64}$')).toBeLessThan(authIndex);
    expect(workflow.indexOf('MIGRATION_OWNER_KEY" =~ ^[a-f0-9]{12}$')).toBeLessThan(authIndex);
    expect(workflow.indexOf('MIGRATION_SOURCE_REVISION" =~ ^[a-f0-9]{64}$')).toBeLessThan(authIndex);
  });

  it('keeps shared-deck migration behind protected immutable inputs', () => {
    const workflow = read('.github/workflows/migrate-legacy-shared-decks.yml');
    expect(workflow).toContain('permissions:\n  actions: read\n  contents: read');
    expect(workflow).toContain('production-shared-deck-inventory');
    expect(workflow).toContain('production-shared-deck-apply');
    expect(workflow).toContain('node-version: 22');
    expect(workflow).toContain('fetch-depth: 0');
    expect(workflow).toContain('git merge-base --is-ancestor');
    expect(workflow).toContain('test "$INVENTORY_REVISION" = "$GITHUB_SHA"');
    expect(workflow).toContain('APPLY_SHARED_DECK_V2');
    expect(workflow).toContain('SUPERSEDE_SHARED_DECK_V2');
    expect(workflow).toContain('supersede_source_revision:');
    expect(workflow).toContain('SUPERSEDE_SOURCE_REVISION');
    expect(workflow).toContain('test "$SUPERSEDE_SOURCE_REVISION" != "$INVENTORY_REVISION"');
    expect(workflow).toContain('PREPARE_INDEXES_V2');
    expect(workflow).toContain('prepare-indexes');
    expect(workflow).toContain('firestore:indexes');
    expect(workflow).toContain('--config artifacts/index-preparation/firebase-project/firebase.json');
    expect(workflow).toContain('google-github-actions/setup-gcloud@aa5489c8933f4cc7a4f7d45035b3b1440c9c10db');
    expect(workflow).toContain('gcloud firestore indexes fields list');
    expect(workflow).not.toContain('gcloud firestore fields list');
    expect(workflow).toContain('gcloud firestore operations list');
    expect(workflow).toContain('--baseline-operations');
    expect(workflow).toContain('completedAt');
    expect(workflow).toContain('operationIds');
    expect(workflow).toContain('active');
    expect(workflow).toContain('verify-firestore-index-preparation.mjs');
    expect(workflow).toContain('seq 1 120');
    expect(workflow).toContain('sleep 10');
    expect(workflow).toContain('indexes_run_id:');
    expect(workflow).toContain('indexes_report_sha256:');
    expect(workflow).toContain('gh run download "$INDEXES_RUN_ID"');
    expect(workflow).toContain('GH_TOKEN: ${{ github.token }}');
    expect(workflow).toContain("APPLY_CONFIRMATION: ${{ inputs.mode == 'apply' && secrets.APPLY_CONFIRMATION || '' }}");
    expect(workflow).toContain("BACKUP_MANIFEST_JSON: ${{ inputs.mode == 'apply' && secrets.BACKUP_MANIFEST_JSON || '' }}");
    expect(workflow).toContain("SUPERSEDE_CONFIRMATION: ${{ inputs.mode == 'supersede' && secrets.SUPERSEDE_CONFIRMATION || '' }}");
    expect(workflow).toContain("PREPARE_INDEXES_CONFIRMATION: ${{ inputs.mode == 'prepare-indexes' && secrets.PREPARE_INDEXES_CONFIRMATION || '' }}");
    expect(workflow).toContain("OWNER_UID: ${{ inputs.mode != 'prepare-indexes' && secrets.OWNER_UID || '' }}");
    expect(workflow).toContain(".path' <<<\"$run_json\")" );
    expect(workflow).toContain(".indexDigest' \"$report\")");
    expect(workflow).toContain('BACKUP_MANIFEST_JSON');
    expect(workflow).toContain('secrets.OWNER_UID');
    expect(workflow).toContain('artifacts/legacy-shared-deck-report.json');
    expect(workflow).toContain('MIGRATION_MODE');
    expect(workflow).toContain('git merge-base --is-ancestor');
    expect(workflow).not.toContain('functions/lib/legacySharedDeckMigrationOperator.js --');
  });

  it('installs and verifies the local Firebase CLI before preparing indexes', () => {
    const workflow = read('.github/workflows/migrate-legacy-shared-decks.yml');
    const cliInstallIndex = workflow.indexOf('name: Install the trusted root Firebase CLI');
    const cliVersionIndex = workflow.indexOf('test "$(./node_modules/.bin/firebase --version)" = "15.23.0"');
    const prepareAuthIndex = workflow.indexOf('google-github-actions/auth@');
    const prepareStepIndex = workflow.indexOf('name: Prepare and deploy the exact candidate Firestore indexes');
    const indexesOnlyConfigIndex = workflow.indexOf('artifacts/index-preparation/firebase-project/firebase.json');
    const predeployIndex = workflow.indexOf('run: npm run predeploy:firestore');
    const indexDeployIndex = workflow.indexOf('./node_modules/.bin/firebase deploy --only firestore:indexes');
    expect(cliInstallIndex).toBeGreaterThan(-1);
    expect(workflow.slice(cliInstallIndex)).toContain('npm ci --ignore-scripts --no-audit --no-fund');
    expect(cliVersionIndex).toBeGreaterThan(cliInstallIndex);
    expect(prepareAuthIndex).toBeGreaterThan(cliVersionIndex);
    expect(prepareStepIndex).toBeGreaterThan(prepareAuthIndex);
    expect(indexesOnlyConfigIndex).toBeGreaterThan(prepareAuthIndex);
    expect(indexDeployIndex).toBeGreaterThan(prepareAuthIndex);
    expect(indexDeployIndex).toBeGreaterThan(indexesOnlyConfigIndex);
    expect(predeployIndex).toBeGreaterThan(prepareAuthIndex);
    expect(indexesOnlyConfigIndex).toBeGreaterThan(predeployIndex);
    expect(indexDeployIndex).toBeGreaterThan(indexesOnlyConfigIndex);
    expect(workflow).toContain('--config artifacts/index-preparation/firebase-project/firebase.json');
    expect(workflow).toContain('git diff --exit-code "$GITHUB_SHA" -- firestore.indexes.json');
    expect(workflow).toContain('cp firestore.indexes.json artifacts/index-preparation/firebase-project/firestore.indexes.json');
    expect(workflow).toContain('jq --null-input --arg database "$FIRESTORE_DATABASE_ID"');
    expect(workflow).toContain('test -s artifacts/index-preparation/firebase-project/firebase.json');
    expect(workflow).toContain('--indexes artifacts/index-preparation/firebase-project/firestore.indexes.json');
    expect(workflow).toContain('indexes: "firestore.indexes.json"');
    expect(workflow.slice(prepareStepIndex, indexDeployIndex)).not.toContain('rules:');
    expect(workflow.slice(prepareStepIndex, indexDeployIndex)).not.toContain('firestore.rules');
    expect(workflow).not.toContain('npx --yes firebase-tools');
  });

  it('only seals an index report after active field and operation readback', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingoflash-index-report-'));
    try {
      const indexes = { fieldOverrides: [{ collectionGroup: 'shared_decks', fieldPath: 'cards', indexes: [] }] };
      fs.writeFileSync(path.join(directory, 'indexes.json'), JSON.stringify(indexes));
      fs.writeFileSync(path.join(directory, 'active.json'), JSON.stringify([{
        collectionGroup: 'shared_decks', fieldPath: 'cards', indexConfig: { indexes: [] },
      }]));
      fs.writeFileSync(path.join(directory, 'operations.json'), JSON.stringify([{ name: 'operations/1', done: true }]));
      fs.writeFileSync(path.join(directory, 'baseline.json'), '[]');
      execFileSync(process.execPath, ['scripts/verify-firestore-index-preparation.mjs',
        '--indexes', path.join(directory, 'indexes.json'), '--active', path.join(directory, 'active.json'),
        '--operations', path.join(directory, 'operations.json'), '--baseline-operations', path.join(directory, 'baseline.json'),
        '--target', 'project/database',
        '--revision', 'a'.repeat(40), '--output', path.join(directory, 'report.json')], { stdio: 'pipe' });
      const report = JSON.parse(fs.readFileSync(path.join(directory, 'report.json'), 'utf8'));
      assert.equal(report.active, true);
      assert.deepEqual(report.operationIds, ['operations/1']);
      assert.equal(report.revision, 'a'.repeat(40));
      assert.match(report.completedAt, /^20/);
      fs.writeFileSync(path.join(directory, 'baseline.json'), JSON.stringify([{ name: 'operations/1', done: false }]));
      execFileSync(process.execPath, ['scripts/verify-firestore-index-preparation.mjs',
        '--indexes', path.join(directory, 'indexes.json'), '--active', path.join(directory, 'active.json'),
        '--operations', path.join(directory, 'operations.json'), '--baseline-operations', path.join(directory, 'baseline.json'),
        '--target', 'project/database', '--revision', 'a'.repeat(40),
        '--output', path.join(directory, 'report.json')], { stdio: 'pipe' });
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'report.json'), 'utf8')).operationIds, []);
      fs.writeFileSync(path.join(directory, 'active.json'), JSON.stringify([{
        collectionGroup: 'shared_decks', fieldPath: 'cards', indexConfig: { indexes: [], reverting: true },
      }]));
      assert.throws(() => execFileSync(process.execPath, ['scripts/verify-firestore-index-preparation.mjs',
        '--indexes', path.join(directory, 'indexes.json'), '--active', path.join(directory, 'active.json'),
        '--operations', path.join(directory, 'operations.json'), '--baseline-operations', path.join(directory, 'baseline.json'),
        '--target', 'project/database',
        '--revision', 'a'.repeat(40), '--output', path.join(directory, 'report.json')], { stdio: 'pipe' }));
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
