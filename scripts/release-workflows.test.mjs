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
    expect(packageJson.devDependencies['firebase-tools']).toBe('15.29.0');
    expect(packageLock.packages[''].devDependencies['firebase-tools']).toBe('15.29.0');
    expect(packageLock.packages['node_modules/firebase-tools'].version).toBe('15.29.0');

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
        const version = job.indexOf('test "$(./node_modules/.bin/firebase --version)" = "15.29.0"');
        const auth = job.indexOf('google-github-actions/auth@');
        expect(install).toBeGreaterThan(-1);
        expect(version).toBeGreaterThan(install);
        expect(auth).toBeGreaterThan(version);
        expect(job).toContain('./node_modules/.bin/firebase deploy');
        expect(job).not.toContain('npx --yes firebase-tools');
      }
    }
  });

  it('uses exactly one approved Firebase CLI pin and a fixed js-yaml resolution', () => {
    const approvedVersion = '15.29.0';
    const packageJson = JSON.parse(read('package.json'));
    const packageLock = JSON.parse(read('package-lock.json'));
    const trackedFiles = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
    const firebaseSurfaces = trackedFiles.filter(relativePath => (
      relativePath === 'firebase.json'
      || /(?:^|\/)package(?:-lock)?\.json$/.test(relativePath)
      || /^\.github\/workflows\/[^/]+\.ya?ml$/.test(relativePath)
      || /^scripts\/[^/]+\.(?:[cm]?js|ts)$/.test(relativePath) && !/\.test\.[cm]?js$/.test(relativePath)
    ));

    expect(packageJson.devDependencies['firebase-tools']).toBe(approvedVersion);
    expect(packageJson.scripts['test:rules']).toContain('./node_modules/.bin/firebase');
    expect(packageLock.packages['node_modules/firebase-tools'].version).toBe(approvedVersion);
    expect(packageLock.packages['node_modules/js-yaml'].version).toMatch(/^4\.(?:3\.[2-9]|[4-9]\.|[1-9][0-9]+\.)/);
    for (const relativePath of firebaseSurfaces) {
      const source = read(relativePath);
      for (const [, version] of source.matchAll(/firebase-tools(?:@|["']\s*:\s*["'])[^0-9]*(\d+\.\d+\.\d+)/g)) {
        expect(version).toBe(approvedVersion);
      }
      for (const [, version] of source.matchAll(/firebase --version\)" = "(\d+\.\d+\.\d+)"/g)) {
        expect(version).toBe(approvedVersion);
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
    expect(hostingJob).toContain('needs: [validate_candidate, deploy_functions]');
    expect(hostingJob).toContain("if: ${{ !cancelled() && needs.validate_candidate.result == 'success' && (needs.deploy_functions.result == 'success' || (!inputs.promote_functions && needs.deploy_functions.result == 'skipped')) }}");
    expect(functionsJob).toContain('needs: validate_candidate');
    expect(functionsJob).not.toContain('needs: [validate_candidate, deploy_hosting]');
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
    expect(workflow.match(/environment: \$\{\{ inputs\.operation == 'cutover' && 'production-rules-cutover' \|\| 'production-rules-rollback' \}\}/g)).toHaveLength(2);
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

  it('checks the ready Pro entitlement index before promoting production Functions', () => {
    const workflow = read('.github/workflows/deploy-production.yml');
    expect(workflow).toContain('gcloud firestore indexes composite list --project="$FIREBASE_PROJECT_ID" --database="$FIRESTORE_DATABASE_ID" --format=json');
    expect(workflow).toContain('node scripts/verify-entitlement-index.mjs "$FIREBASE_PROJECT_ID" "$FIRESTORE_DATABASE_ID"');
    expect(workflow.indexOf('Verify Pro intent Firestore index is ready')).toBeLessThan(
      workflow.indexOf('Promote only the sealed Functions artifact'),
    );
  });

  it('requires a revision-bound Firestore safety receipt before production promotion', () => {
    const workflow = read('.github/workflows/deploy-production.yml');
    const validateJob = workflow.slice(workflow.indexOf('  validate_candidate:'), workflow.indexOf('  deploy_hosting:'));
    const safetyReceiptIndex = workflow.indexOf('name: Verify the Firestore release-safety receipt');
    const hostingDeployIndex = workflow.indexOf('Promote only the sealed Hosting artifact');

    expect(workflow).toContain('firestore_safety_run_id:');
    expect(workflow).toContain('firestore_safety_receipt_sha256:');
    expect(validateJob).toContain('.github/workflows/verify-firestore-release-safety.yml');
    expect(validateJob).toContain('test "$(jq -er \'.head_sha\' <<<"$run_json")" = "$REVISION"');
    expect(validateJob).toContain('firestore-release-safety-${REVISION}-${FIRESTORE_SAFETY_RUN_ID}');
    expect(validateJob).toContain('run-id: ${{ inputs.firestore_safety_run_id }}');
    expect(validateJob).toContain('sha256sum "$receipt"');
    expect(validateJob).toContain('.backup.retentionLocked == true');
    expect(validateJob).toContain('.backup.retentionSeconds | type == "number" and . >= 7776000');
    expect(validateJob).toContain('.restore.documentCount == .backup.documentCount');
    expect(validateJob).toContain('.restore.deletedAfterVerification == true');
    expect(validateJob).toContain('library_facet_receipts');
    expect(validateJob).toContain('shared_deck_receipts');
    expect(safetyReceiptIndex).toBeGreaterThan(-1);
    expect(hostingDeployIndex).toBeGreaterThan(safetyReceiptIndex);
    expect(workflow).toContain('group: firestore-production-mutations');
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
    expect(workflow).toContain('source_revision:');
    expect(workflow).toContain('MIGRATION_SOURCE_REVISION');
    expect(workflow).toContain('test "$MIGRATION_SOURCE_REVISION" != "$INVENTORY_REVISION"');
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

  it('requires the same Firestore safety receipt before legacy index preparation', () => {
    const workflow = read('.github/workflows/migrate-legacy-shared-decks.yml');
    const receiptIndex = workflow.indexOf('name: Verify the Firestore release-safety receipt');
    const deployIndex = workflow.indexOf('./node_modules/.bin/firebase deploy --only firestore:indexes');

    expect(workflow).toContain('firestore_safety_run_id:');
    expect(workflow).toContain('firestore_safety_receipt_sha256:');
    expect(workflow).toContain("inputs.mode == 'prepare-indexes' && 'firestore-production-mutations'");
    expect(workflow).toContain('.github/workflows/verify-firestore-release-safety.yml');
    expect(workflow).toContain('firestore-release-safety-${INVENTORY_REVISION}-${FIRESTORE_SAFETY_RUN_ID}');
    expect(workflow).toContain('sha256sum "$receipt"');
    expect(receiptIndex).toBeGreaterThan(-1);
    expect(deployIndex).toBeGreaterThan(receiptIndex);
  });

  it('backs up and restores Firestore before enabling receipt TTL policies', () => {
    const workflow = read('.github/workflows/verify-firestore-release-safety.yml');
    const exportIndex = workflow.indexOf('gcloud firestore export');
    const importIndex = workflow.indexOf('gcloud firestore import');
    const deleteIndex = workflow.indexOf('gcloud firestore databases delete');
    const ttlIndex = workflow.indexOf('gcloud firestore fields ttls update');
    const operationDescribeIndexes = [...workflow.matchAll(/gcloud firestore operations describe/g)]
      .map((match) => match.index);
    const exportStep = workflow.slice(
      workflow.lastIndexOf('\n      - name:', exportIndex),
      workflow.indexOf('\n      - name:', exportIndex),
    );
    const importStep = workflow.slice(
      workflow.lastIndexOf('\n      - name:', importIndex),
      workflow.indexOf('\n      - name:', importIndex),
    );
    const completedOperationCheck = '.done == true and (has("error") | not)';

    expect(workflow).toContain('environment: production-shared-deck-index-preparation');
    expect(workflow).toContain('test "$GITHUB_REF" = "refs/heads/$DEFAULT_BRANCH"');
    expect(workflow).toContain('FIRESTORE_RELEASE_SAFETY_CONFIRMATION');
    expect(workflow).toContain('BACKUP_RESTORE_TTL_V1');
    expect(workflow).toContain('gcloud storage buckets describe "gs://$FIRESTORE_BACKUP_BUCKET"');
    expect(workflow).toContain('--raw --format=json > artifacts/firestore-release-safety/backup-bucket.json');
    expect(workflow).not.toContain('token_format: access_token');
    expect(workflow).not.toContain('steps.auth.outputs.access_token');
    expect(workflow).toContain('.retentionPolicy.isLocked == true');
    expect(workflow).toContain('retentionPolicy.retentionPeriod | tonumber) >= 7776000');
    expect(execFileSync('jq', [
      '-e',
      '.retentionPolicy.isLocked == true and ((.retentionPolicy.retentionPeriod | tonumber) >= 7776000)',
    ], {
      input: JSON.stringify({
        retentionPolicy: { isLocked: true, retentionPeriod: '7776000' },
      }),
      encoding: 'utf8',
    })).toContain('true');
    expect(exportIndex).toBeGreaterThan(-1);
    expect(importIndex).toBeGreaterThan(exportIndex);
    expect(operationDescribeIndexes).toHaveLength(2);
    expect(operationDescribeIndexes[0]).toBeGreaterThan(exportIndex);
    expect(operationDescribeIndexes[0]).toBeLessThan(importIndex);
    expect(operationDescribeIndexes[1]).toBeGreaterThan(importIndex);
    expect(operationDescribeIndexes[1]).toBeLessThan(deleteIndex);
    expect(exportStep).toContain('> artifacts/firestore-release-safety/export-operation-start.json');
    expect(exportStep).toContain(`export_operation="$(jq -er '.name' artifacts/firestore-release-safety/export-operation-start.json)"`);
    expect(exportStep).toContain('[[ "$export_operation" == "projects/$FIREBASE_PROJECT_ID/databases/$FIRESTORE_DATABASE_ID/operations/"* ]]');
    expect(exportStep).toContain('gcloud firestore operations describe "$export_operation"');
    expect(exportStep).toContain('--format=json > artifacts/firestore-release-safety/export-operation.json');
    expect(exportStep).toContain("jq -e '.done == true and (has(\"error\") | not)' \\");
    expect(exportStep).toContain("jq -er '.response.outputUriPrefix // .metadata.outputUriPrefix' artifacts/firestore-release-safety/export-operation.json");
    expect(exportStep).toContain("jq -er '.metadata.progressDocuments.completedWork | select(type == \"string\" or type == \"number\") | tostring' artifacts/firestore-release-safety/export-operation.json");
    expect(importStep).toContain('> artifacts/firestore-release-safety/import-operation-start.json');
    expect(importStep).toContain(`import_operation="$(jq -er '.name' artifacts/firestore-release-safety/import-operation-start.json)"`);
    expect(importStep).toContain('[[ "$import_operation" == "projects/$FIREBASE_PROJECT_ID/databases/$RESTORE_DATABASE_ID/operations/"* ]]');
    expect(importStep).toContain('gcloud firestore operations describe "$import_operation"');
    expect(importStep).toContain('--format=json > artifacts/firestore-release-safety/import-operation.json');
    expect(importStep).toContain("jq -e '.done == true and (has(\"error\") | not)' \\");
    expect(importStep).toContain("jq -er '.metadata.progressDocuments.completedWork | select(type == \"string\" or type == \"number\") | tostring' artifacts/firestore-release-safety/import-operation.json");
    assert.throws(() => execFileSync('jq', ['-e', completedOperationCheck], {
      input: JSON.stringify({ metadata: { operationState: 'PROCESSING' } }),
      encoding: 'utf8',
    }));
    expect(execFileSync('jq', ['-e', completedOperationCheck], {
      input: JSON.stringify({ done: true, metadata: { operationState: 'SUCCESSFUL' }, response: {} }),
      encoding: 'utf8',
    })).toContain('true');
    expect(deleteIndex).toBeGreaterThan(importIndex);
    expect(ttlIndex).toBeGreaterThan(deleteIndex);
    expect(workflow).toContain('release-restore-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT');
    expect(workflow).toContain('test "$import_documents" = "$FIRESTORE_EXPORT_DOCUMENTS"');
    expect(workflow).toContain('always() && env.RESTORE_DATABASE_ID !=');
    expect(workflow).toContain('needs: verify');
    expect(workflow).toContain('if: ${{ always() }}');
    expect(workflow).toContain('group: firestore-production-mutations');
    expect(workflow).toContain("cron: '17 * * * *'");
    expect(workflow).toContain("if: ${{ github.event_name == 'workflow_dispatch' }}");
    expect(workflow.slice(workflow.indexOf('  cleanup:'))).toContain('timeout-minutes: 60');
    expect(workflow).toContain('CLEANUP_MODE=scheduled');
    expect(workflow).toContain('release-restore-[1-9][0-9]{0,19}-[1-9][0-9]{0,9}');
    expect(workflow).toContain('cleanup_failures+=("operations:$restore_database_id")');
    expect(workflow).toContain('cleanup_failures+=("deletion:$restore_database_id")');
    expect(workflow).toContain('Firestore cleanup failed for: %s');
    expect(workflow).toContain("--filter='done:false'");
    expect(workflow).toContain('gcloud firestore operations cancel');
    expect(workflow).toContain('test "$restore_database_id" != "$FIRESTORE_DATABASE_ID"');
    expect(workflow).toContain('VERIFY_RESULT: ${{ needs.verify.result }}');
    expect(workflow).toContain('Unable to rule out late creation');
    expect(workflow).toContain('select(type == "string" or type == "number") | tostring');
    expect(workflow).not.toContain('completedWork // "0"');
    expect(workflow).toContain('library_facet_receipts');
    expect(workflow).toContain('shared_deck_receipts');
    expect(workflow).toContain('(.ttlConfig.state // "") == "ACTIVE"');
    expect(workflow).toContain('artifacts/firestore-release-safety/receipt.json');
    expect(workflow).toContain('retention-days: 90');
    expect(workflow).not.toContain('firebase deploy');
  });

  it('installs and verifies the local Firebase CLI before preparing indexes', () => {
    const workflow = read('.github/workflows/migrate-legacy-shared-decks.yml');
    const cliInstallIndex = workflow.indexOf('name: Install the trusted root Firebase CLI');
    const cliVersionIndex = workflow.indexOf('test "$(./node_modules/.bin/firebase --version)" = "15.29.0"');
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
    expect(workflow).toContain('gcloud firestore databases describe');
    expect(workflow).toContain('--database-metadata artifacts/index-preparation/database.json');
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
      fs.writeFileSync(path.join(directory, 'database.json'), JSON.stringify({ databaseEdition: 'STANDARD' }));
      fs.writeFileSync(path.join(directory, 'operations.json'), JSON.stringify([{ name: 'operations/1', done: true }]));
      fs.writeFileSync(path.join(directory, 'baseline.json'), '[]');
      execFileSync(process.execPath, ['scripts/verify-firestore-index-preparation.mjs',
        '--indexes', path.join(directory, 'indexes.json'), '--active', path.join(directory, 'active.json'),
        '--database-metadata', path.join(directory, 'database.json'),
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
        '--database-metadata', path.join(directory, 'database.json'),
        '--operations', path.join(directory, 'operations.json'), '--baseline-operations', path.join(directory, 'baseline.json'),
        '--target', 'project/database', '--revision', 'a'.repeat(40),
        '--output', path.join(directory, 'report.json')], { stdio: 'pipe' });
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'report.json'), 'utf8')).operationIds, []);
      fs.writeFileSync(path.join(directory, 'active.json'), JSON.stringify([{
        collectionGroup: 'shared_decks', fieldPath: 'cards', indexConfig: { indexes: [], reverting: true },
      }]));
      assert.throws(() => execFileSync(process.execPath, ['scripts/verify-firestore-index-preparation.mjs',
        '--indexes', path.join(directory, 'indexes.json'), '--active', path.join(directory, 'active.json'),
        '--database-metadata', path.join(directory, 'database.json'),
        '--operations', path.join(directory, 'operations.json'), '--baseline-operations', path.join(directory, 'baseline.json'),
        '--target', 'project/database',
        '--revision', 'a'.repeat(40), '--output', path.join(directory, 'report.json')], { stdio: 'pipe' }));
      fs.writeFileSync(path.join(directory, 'active.json'), '[]');
      fs.writeFileSync(path.join(directory, 'database.json'), JSON.stringify({ databaseEdition: 'ENTERPRISE' }));
      execFileSync(process.execPath, ['scripts/verify-firestore-index-preparation.mjs',
        '--indexes', path.join(directory, 'indexes.json'), '--active', path.join(directory, 'active.json'),
        '--database-metadata', path.join(directory, 'database.json'),
        '--operations', path.join(directory, 'operations.json'), '--baseline-operations', path.join(directory, 'baseline.json'),
        '--target', 'project/database', '--revision', 'a'.repeat(40),
        '--output', path.join(directory, 'report.json')], { stdio: 'pipe' });
      assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(directory, 'report.json'), 'utf8'))).sort(), [
        'active', 'completedAt', 'indexDigest', 'operationIds', 'revision', 'schemaVersion', 'target',
      ]);
      fs.writeFileSync(path.join(directory, 'database.json'), JSON.stringify({ databaseEdition: 'STANDARD' }));
      assert.throws(() => execFileSync(process.execPath, ['scripts/verify-firestore-index-preparation.mjs',
        '--indexes', path.join(directory, 'indexes.json'), '--active', path.join(directory, 'active.json'),
        '--database-metadata', path.join(directory, 'database.json'),
        '--operations', path.join(directory, 'operations.json'), '--baseline-operations', path.join(directory, 'baseline.json'),
        '--target', 'project/database', '--revision', 'a'.repeat(40),
        '--output', path.join(directory, 'report.json')], { stdio: 'pipe' }));
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
