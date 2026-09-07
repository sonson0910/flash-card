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

  it('provides a protected read-only artifact retrieval and bounded verification receipt', () => {
    const workflow = read('.github/workflows/verify-release-artifact.yml');
    expect(workflow).toContain('name: Verify release candidate artifact');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('revision:');
    expect(workflow).toContain('candidate_run_id:');
    expect(workflow).toContain('candidate_sha256:');
    expect(workflow).toContain('permissions:\n  actions: read\n  contents: read');
    expect(workflow).toContain('test "$GITHUB_REF" = "refs/heads/$DEFAULT_BRANCH"');
    expect(workflow).toContain('git merge-base --is-ancestor "$REVISION" "origin/$DEFAULT_BRANCH"');
    expect(workflow).toContain('test "$(git rev-parse HEAD)" = "$GITHUB_SHA"');
    expect(workflow).toContain('test "$(jq -er \'.conclusion\' <<<"$run_json")" = "success"');
    expect(workflow).toContain('test "$(jq -er \'.event\' <<<"$run_json")" = "workflow_dispatch"');
    expect(workflow).toContain('test "$(jq -er \'.path\' <<<"$run_json")" = ".github/workflows/release-candidate.yml"');
    expect(workflow).toContain('test "$(jq -er \'.head_sha\' <<<"$run_json")" = "$REVISION"');
    expect(workflow).toContain('ref: ${{ github.sha }}');
    expect(workflow).toContain('actions/runs/${CANDIDATE_RUN_ID}/artifacts?name=lingoflash-$REVISION');
    expect(workflow).not.toContain('actions/artifacts?name=lingoflash-$REVISION');
    expect(workflow).not.toContain('.total_count');
    expect(workflow).toContain('.expired == false');
    expect(workflow).toContain('.workflow_run.id == ($CANDIDATE_RUN_ID | tonumber)');
    expect(workflow).toContain('actions/download-artifact@');
    expect(workflow).toContain('run-id: ${{ inputs.candidate_run_id }}');
    expect(workflow).toContain('node scripts/release-artifact.mjs verify');
    expect(workflow).toContain('--root candidate');
    expect(workflow).toContain('--manifest artifacts/release-candidate-manifest.json');
    expect(workflow).toContain('(\\\\.[0-9]{3})?Z$');
    expect(workflow).toContain('scripts/release-receipt.mjs');
    const receiptGenerator = read('scripts/release-receipt.mjs');
    expect(receiptGenerator).toContain('schemaVersion: 1');
    const receiptContract = `${workflow}\n${receiptGenerator}`;
    for (const field of [
      'repositoryId', 'repositoryName', 'verificationRunId', 'verificationRunAttempt',
      'sourceRunId', 'artifactId', 'artifactDigest', 'artifactExpiresAt', 'revision',
      'candidateSha256', 'manifestSha256', 'readinessSha256', 'verifiedAt', 'status',
    ]) expect(receiptContract).toContain(field);
    expect(workflow).toContain('retention-days: 90');
    expect(workflow).toContain('GITHUB_STEP_SUMMARY');
    expect(workflow).not.toMatch(/environment:/);
    expect(workflow).not.toMatch(/secrets\./);
    expect(workflow).not.toMatch(/id-token/);
    expect(workflow).not.toMatch(/deployments:/);
    expect(workflow).not.toMatch(/google-github-actions\/auth/);
    expect(workflow).not.toMatch(/firebase deploy/);
    expect(workflow).not.toMatch(/npm (?:ci|install)/);
    expect(workflow).not.toMatch(/node candidate\//);
  });

  it('archives a verified candidate once and retrieves it with a read-only identity', () => {
    const archive = read('.github/workflows/archive-release-candidate.yml');
    const verify = read('.github/workflows/verify-release-archive.yml');
    for (const workflow of [archive, verify]) {
      expect(workflow).toContain('test "$GITHUB_REF" = "refs/heads/$DEFAULT_BRANCH"');
      expect(workflow).toContain('git merge-base --is-ancestor "$REVISION" "origin/$DEFAULT_BRANCH"');
      expect(workflow).toContain('node scripts/release-artifact.mjs verify');
      expect(workflow).toContain('candidate_run_id:');
      expect(workflow).toContain('candidate_sha256:');
      expect(workflow).toContain('google-github-actions/auth@7c6bc770dae815cd3e89ee6cdf493a5fab2cc093');
    }
    expect(archive).toContain('environment: release-archive');
    expect(archive).toContain('ifGenerationMatch=0');
    expect(archive).toContain('release-archive-receipt.json');
    expect(archive).toContain('http_status" == "200"');
    expect(archive).toContain('http_status" != "412"');
    expect(archive).toContain('run-id: ${{ inputs.candidate_run_id }}');
    expect(archive).toContain('test "$(jq -er \'.path\' <<<"$run_json")" = ".github/workflows/release-candidate.yml"');
    expect(verify).toContain('environment: release-verification');
    expect(verify).toContain('name: Verify immutable release archive');
    expect(verify).toContain('READ-ONLY WORM retrieval: verified');
    expect(verify).not.toContain('ifGenerationMatch=0');
    expect(verify).not.toContain('--request POST');
    expect(verify).not.toContain('actions: write');
    expect(verify).toContain('retrieved-candidate-${{ inputs.revision }}-${{ github.run_id }}');
    expect(verify).toContain('artifacts/archive/extracted/release-archive-receipt.json');
  });

  it('deploys staging only from an exact sealed candidate and emits target-bound evidence', () => {
    const workflow = read('.github/workflows/deploy-staging.yml');
    expect(workflow).toContain('name: Deploy staging candidate');
    expect(workflow).toContain('permissions:\n  actions: read\n  contents: read\n  id-token: write');
    expect(workflow).toContain('environment: staging');
    expect(workflow).toContain('test "$(jq -er \'.path\' <<<"$run_json")" = ".github/workflows/release-candidate.yml"');
    expect(workflow).toContain('run-id: ${{ inputs.candidate_run_id }}');
    expect(workflow).toContain('--project-id "$FIREBASE_PROJECT_ID" --database-id "$FIRESTORE_DATABASE_ID"');
    expect(workflow).toContain('--origin "$STAGING_ORIGIN"');
    expect(workflow).toContain('release-artifact.mjs promote-config');
    expect(workflow).toContain('workload_identity_provider: ${{ vars.GCP_WORKLOAD_IDENTITY_PROVIDER }}');
    expect(workflow).toContain('service_account: ${{ vars.GCP_SERVICE_ACCOUNT }}');
    expect(workflow).toContain('--only firestore:rules');
    expect(workflow).toContain('--only functions');
    expect(workflow).toContain('parameter_file="functions/.env.${FIREBASE_PROJECT_ID}"');
    expect(workflow).toContain("printf '%s\\n' 'ENFORCE_APP_CHECK=true' > \"$parameter_file\"");
    expect(workflow).toContain("grep -qxF 'ENFORCE_APP_CHECK=true' \"$parameter_file\"");
    expect(workflow).toContain('trap cleanup EXIT');
    expect(workflow).toContain('rm -f -- "$parameter_file"');
    expect(workflow).not.toContain('ENFORCE_APP_CHECK=false');
    expect(workflow).toContain('--only hosting');
    expect(workflow).toContain('scripts/staging-deployment-receipt.mjs');
    expect(workflow).toContain('release-staging-receipt-${{ inputs.revision }}-${{ github.run_id }}');
    expect(workflow).not.toContain('credentials_json:');
    expect(workflow).not.toContain('npm run build');
    expect(workflow).not.toContain('npm run predeploy');
  });

  it('gates staging composite indexes before Rules, Functions, and Hosting', () => {
    const workflow = read('.github/workflows/deploy-staging.yml');
    const authIndex = workflow.indexOf('google-github-actions/auth@7c6bc770dae815cd3e89ee6cdf493a5fab2cc093');
    const setupGcloudIndex = workflow.indexOf('google-github-actions/setup-gcloud@aa5489c8933f4cc7a4f7d45035b3b1440c9c10db');
    const readinessIndex = workflow.indexOf('name: Deploy and verify candidate Firestore composite indexes');
    const rulesIndex = workflow.indexOf('Deploy only sealed Firestore Rules');
    const functionsIndex = workflow.indexOf('Deploy only sealed Functions');
    const hostingIndex = workflow.indexOf('Deploy only sealed Hosting bytes');
    expect(workflow).toContain('timeout-minutes: 45');
    expect(setupGcloudIndex).toBeGreaterThan(authIndex);
    expect(readinessIndex).toBeGreaterThan(setupGcloudIndex);
    expect(rulesIndex).toBeGreaterThan(readinessIndex);
    expect(functionsIndex).toBeGreaterThan(readinessIndex);
    expect(hostingIndex).toBeGreaterThan(readinessIndex);
    expect(workflow).toContain('firebase deploy --only firestore:indexes --config firebase.promoted.json');
    expect(workflow).toContain('candidate/firestore.indexes.json');
    expect(workflow).toContain('gcloud firestore indexes composite list');
    expect(workflow).toContain('gcloud firestore indexes fields list');
    expect(workflow).toContain('seq 1 120');
    expect(workflow).toContain('sleep 10');
    expect(workflow).toContain('firestore-index-readiness.json');
    expect(workflow).toContain('release-staging-index-readiness-${{ inputs.revision }}-${{ github.run_id }}');
    expect(workflow).toContain('indexDigest');
    expect(workflow).not.toContain('--only firestore,');
    expect(workflow).not.toContain('firebase deploy --only firestore --config');
  });

  it('blocks production until the exact staging deployment receipt is verified', () => {
    const workflow = read('.github/workflows/deploy-production.yml');
    expect(workflow).toContain('staging_run_id:');
    expect(workflow).toContain('staging_receipt_sha256:');
    expect(workflow).toContain('staging_smoke_sha256:');
    expect(workflow).toContain('archive_verification_run_id:');
    expect(workflow).toContain('archive_verification_receipt_sha256:');
    expect(workflow).toContain('approval_nonce:');
    expect(workflow).toContain('approval_expires_at_epoch:');
    expect(workflow).toContain('environment: production-approval');
    expect(workflow).toContain('promotion:$REVISION:$CANDIDATE_RUN_ID:$CANDIDATE_SHA256:$ARCHIVE_VERIFICATION_RUN_ID:$ARCHIVE_VERIFICATION_RECEIPT_SHA256:$STAGING_RUN_ID:$STAGING_RECEIPT_SHA256:$STAGING_SMOKE_SHA256:$PROMOTE_FUNCTIONS:$APPROVAL_NONCE:$APPROVAL_EXPIRES_AT_EPOCH:$APP_CHECK_OBSERVATION_REF');
    expect(workflow).toContain('test "$promotion_approval_sha256" = "$PROTECTED_PROMOTION_APPROVAL_SHA256"');
    expect(workflow).toContain('test "$(jq -er \'.path\' <<<"$run_json")" = ".github/workflows/deploy-staging.yml"');
    expect(workflow).toContain('run-id: ${{ inputs.staging_run_id }}');
    expect(workflow).toContain('staging-deployment-receipt.mjs verify');
    expect(workflow).toContain('sha256sum staging-receipt/staging-deployment-receipt.json');
    expect(workflow).toContain('test "$(jq -er \'.path\' <<<"$run_json")" = ".github/workflows/verify-release-archive.yml"');
    expect(workflow).toContain('release-archive-verification-${{ inputs.revision }}-${{ inputs.archive_verification_run_id }}');
    expect(workflow).toContain('retrieved-candidate-${{ inputs.revision }}-${{ inputs.archive_verification_run_id }}');
    expect(workflow).toContain('sha256sum "$receipt"');
    expect(workflow).toContain('approval-consumption/$OPERATION/$APPROVAL_NONCE');
    expect(workflow).toContain('ifGenerationMatch=0');
    expect(workflow).toContain('(( APPROVAL_EXPIRES_AT_EPOCH <= now_epoch + 1800 ))');
  });

  it('gates production Hosting on READY composite indexes from the sealed candidate', () => {
    const workflow = read('.github/workflows/deploy-production.yml');
    const indexJob = workflow.slice(workflow.indexOf('  deploy_indexes:'), workflow.indexOf('  deploy_hosting:'));
    const hostingJob = workflow.slice(workflow.indexOf('  deploy_hosting:'));
    const authIndex = indexJob.indexOf('google-github-actions/auth@7c6bc770dae815cd3e89ee6cdf493a5fab2cc093');
    const setupGcloudIndex = indexJob.indexOf('google-github-actions/setup-gcloud@aa5489c8933f4cc7a4f7d45035b3b1440c9c10db');
    const readinessIndex = indexJob.indexOf('name: Deploy and verify candidate Firestore composite indexes');
    const hostingIndex = hostingJob.indexOf('Promote only the sealed Hosting artifact');
    const functionsJob = workflow.slice(workflow.indexOf('  deploy_functions:'));
    expect(indexJob).toContain('needs: validate_candidate');
    expect(indexJob).toContain('environment: production-hosting');
    expect(functionsJob).toContain('needs: [validate_candidate, deploy_indexes]');
    expect(hostingJob).toContain('needs: [validate_candidate, deploy_indexes, deploy_functions]');
    expect(workflow.indexOf('  deploy_indexes:')).toBeLessThan(workflow.indexOf('  deploy_functions:'));
    expect(workflow.indexOf('  deploy_indexes:')).toBeLessThan(workflow.indexOf('  deploy_hosting:'));
    expect(indexJob).toContain('timeout-minutes: 45');
    expect(hostingJob).toContain('timeout-minutes: 15');
    expect(setupGcloudIndex).toBeGreaterThan(authIndex);
    expect(readinessIndex).toBeGreaterThan(setupGcloudIndex);
    expect(indexJob).toContain('firebase deploy --only firestore:indexes --config firebase.promoted.json');
    expect(indexJob).toContain('candidate/firestore.indexes.json');
    expect(indexJob).toContain('gcloud firestore indexes composite list');
    expect(indexJob).toContain('gcloud firestore indexes fields list');
    expect(indexJob).toContain('seq 1 120');
    expect(indexJob).toContain('sleep 10');
    expect(indexJob).toContain('firestore-index-readiness.json');
    expect(indexJob).toContain('release-production-index-readiness-${{ inputs.revision }}-${{ github.run_id }}');
    expect(indexJob).toContain('indexDigest');
    expect(hostingIndex).toBeGreaterThan(-1);
    expect(hostingJob).not.toContain('firestore:indexes');
    expect(hostingJob).not.toContain('setup-gcloud@');
  });

  it('keeps incident rollback available only through bounded LKG evidence', () => {
    const workflow = read('.github/workflows/deploy-production.yml');
    expect(workflow).toContain('operation:');
    expect(workflow).toContain('- rollback');
    expect(workflow).toContain('rollback_evidence_ref:');
    expect(workflow).toContain('if: ${{ inputs.operation == \'promotion\' }}');
    expect(workflow).toContain('[[ "$ROLLBACK_EVIDENCE_REF" =~ ^[A-Za-z0-9._/-]{8,200}$ ]]');
    expect(workflow).toContain('rollback:$REVISION:$CANDIDATE_RUN_ID:$CANDIDATE_SHA256:$ARCHIVE_VERIFICATION_RUN_ID:$ARCHIVE_VERIFICATION_RECEIPT_SHA256:$ROLLBACK_EVIDENCE_REF:$PROMOTE_FUNCTIONS:$APPROVAL_NONCE:$APPROVAL_EXPIRES_AT_EPOCH:$APP_CHECK_OBSERVATION_REF');
    expect(workflow).toContain('test "$rollback_approval_sha256" = "$PROTECTED_ROLLBACK_APPROVAL_SHA256"');
  });

  it('generates a receipt containing only bounded verification metadata', async () => {
    const generatorUrl = new URL('./release-receipt.mjs', import.meta.url);
    assert.ok(fs.existsSync(generatorUrl), 'receipt generator must exist');
    const { createReleaseVerificationReceipt } = await import('./release-receipt.mjs');
    const values = {
      repositoryId: '12345',
      repositoryName: 'sonson0910/lingoflash',
      verificationRunId: '67890',
      verificationRunAttempt: '1',
      sourceRunId: '54321',
      artifactId: '98765',
      artifactDigest: `sha256:${'a'.repeat(64)}`,
      artifactExpiresAt: '2026-12-01T00:00:00.000Z',
      revision: 'b'.repeat(40),
      candidateSha256: 'c'.repeat(64),
      manifestSha256: 'd'.repeat(64),
      readinessSha256: 'e'.repeat(64),
      verifiedAt: '2026-09-06T00:00:00.000Z',
    };
    const receipt = createReleaseVerificationReceipt(values);
    assert.deepEqual(Object.keys(receipt).sort(), [
      'artifactDigest', 'artifactExpiresAt', 'artifactId', 'candidateSha256',
      'manifestSha256', 'readinessSha256', 'repositoryId', 'repositoryName',
      'revision', 'schemaVersion', 'sourceRunId', 'status', 'verificationRunAttempt',
      'verificationRunId', 'verifiedAt',
    ]);
    assert.deepEqual(receipt, { ...values, schemaVersion: 1, status: 'verified' });
    assert.equal(
      createReleaseVerificationReceipt({
        ...values,
        artifactExpiresAt: '2026-09-19T09:04:09Z',
      }).artifactExpiresAt,
      '2026-09-19T09:04:09.000Z',
    );
  });

  it('retains source candidates for the 90-day rollback policy without extending browser evidence', () => {
    const workflow = read('.github/workflows/release-candidate.yml');
    const browserEvidence = workflow.slice(
      workflow.indexOf('name: Retain browser failure evidence'),
      workflow.indexOf('name: Upload the sealed release candidate'),
    );
    const candidateArtifact = workflow.slice(workflow.indexOf('name: Upload the sealed release candidate'));
    expect(browserEvidence).toContain('retention-days: 14');
    expect(candidateArtifact).toContain('retention-days: 90');
  });

  it('requires the locked archive in addition to best-effort Actions retention', () => {
    const runbook = read('docs/runbooks/phase-6-rollout.md');
    expect(runbook).toContain('may be manually deleted');
    expect(runbook).toContain('organization policy');
    expect(runbook).toContain('best-effort operational retention');
    expect(runbook).toContain('90-day retention-locked WORM bucket');
    expect(runbook).toContain('can create objects but cannot read or delete them');
    expect(runbook).toContain('can read objects but cannot create, overwrite, or');
    expect(runbook).toContain('eligible retained LKG');
    expect(runbook).not.toContain('that is the planned rollback window');
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
      ['.github/workflows/deploy-production.yml', ['deploy_indexes:', 'deploy_hosting:', 'deploy_functions:']],
      ['.github/workflows/deploy-firestore-rules.yml', ['deploy_rules:']],
    ]) {
      const workflow = read(relativePath);
      for (const jobName of jobNames) {
        const start = workflow.indexOf(`  ${jobName}`);
        const end = jobName === 'deploy_indexes:'
          ? workflow.indexOf('  deploy_hosting:')
          : jobName === 'deploy_hosting:' ? workflow.indexOf('  deploy_functions:') : workflow.length;
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

  it('promotes a sealed candidate through explicit Hosting and Functions stages only', () => {
    const workflow = read('.github/workflows/deploy-production.yml');
    const validateJob = workflow.slice(workflow.indexOf('  validate_candidate:'), workflow.indexOf('  deploy_indexes:'));
    const hostingJob = workflow.slice(workflow.indexOf('  deploy_hosting:'), workflow.indexOf('  deploy_functions:'));
    const functionsJob = workflow.slice(workflow.indexOf('  deploy_functions:'));
    expect(workflow).toContain('candidate_run_id:');
    expect(workflow).toContain('candidate_sha256:');
    expect(workflow).toContain('actions: read');
    expect(workflow).toContain('actions/download-artifact@');
    expect(workflow).toContain('release-artifact.mjs verify');
    expect(workflow.match(/--workflow-run-id "\$\{\{ inputs\.candidate_run_id \}\}"/g) ?? []).toHaveLength(4);
    expect(workflow.match(/--project-id "\$FIREBASE_PROJECT_ID" --database-id "\$FIRESTORE_DATABASE_ID"/g) ?? []).toHaveLength(3);
    expect(workflow).toContain('test "$run_path" = ".github/workflows/release-candidate.yml"');
    expect(workflow).toContain('--only hosting');
    expect(workflow).toContain('--only functions');
    expect(validateJob).not.toContain('release-artifact.mjs promote-config');
    expect(workflow.slice(workflow.indexOf('  deploy_indexes:'), workflow.indexOf('  deploy_hosting:'))).toContain('release-artifact.mjs promote-config');
    expect(hostingJob).toContain('release-artifact.mjs promote-config');
    expect(functionsJob).toContain('release-artifact.mjs promote-config');
    expect(hostingJob).toContain('needs: [validate_candidate, deploy_indexes, deploy_functions]');
    expect(hostingJob).toContain("if: ${{ !cancelled() && needs.validate_candidate.result == 'success' && needs.deploy_indexes.result == 'success' && (needs.deploy_functions.result == 'success' || (!inputs.promote_functions && needs.deploy_functions.result == 'skipped')) }}");
    expect(functionsJob).toContain('needs: [validate_candidate, deploy_indexes]');
    expect(functionsJob).not.toContain('needs: [validate_candidate, deploy_hosting]');
    expect(functionsJob).toContain('npm ci --prefix candidate/functions --omit=dev --ignore-scripts --no-audit --no-fund');
    expect(functionsJob.indexOf('npm ci --prefix candidate/functions')).toBeLessThan(
      functionsJob.indexOf('./node_modules/.bin/firebase deploy --only functions'),
    );
    expect(workflow.match(/firebase_project_pattern='\^\[a-z\]\[a-z0-9-\]\{4,28\}\[a-z0-9\]\$'/g)).toHaveLength(3);
    expect(workflow).not.toMatch(/firebase-tools@[^\n]+ deploy --non-interactive\s*$/m);
    expect(workflow).not.toContain('--only firestore --');
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

  it('does not retain the completed reservation migration workflow', () => {
    expect(fs.existsSync(new URL('../.github/workflows/reservation-migration.yml', import.meta.url))).toBe(false);
  });

  it('does not document a local production deploy bypass', () => {
    const readme = read('README.md');
    expect(readme).not.toContain('npx firebase-tools login');
    expect(readme).not.toMatch(/npx firebase-tools deploy\s*$/m);
  });

  it('serves the production service worker with JavaScript and revalidation headers', () => {
    const config = JSON.parse(read('firebase.json'));
    const headers = config.hosting.headers;
    const catchAllIndex = headers.findIndex(({ source }) => source === '**');
    const assetsIndex = headers.findIndex(({ source }) => source === '/assets/**');
    const swIndex = headers.findIndex(({ source }) => source === '/sw.js');
    const indexIndex = headers.findIndex(({ source }) => source === '/index.html');
    const healthIndex = headers.findIndex(({ source }) => source === '/health.json');
    const swHeaders = headers[swIndex]?.headers;

    assert.ok(swIndex > -1);
    assert.ok(swIndex > catchAllIndex);
    assert.ok(swIndex > assetsIndex);
    assert.ok(swIndex < indexIndex);
    assert.ok(swIndex < healthIndex);
    assert.deepEqual(swHeaders, [
      { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
      { key: 'Cache-Control', value: 'no-cache,no-store,must-revalidate' },
    ]);
    assert.deepEqual(headers[indexIndex].headers, [
      { key: 'Cache-Control', value: 'no-cache,no-store,must-revalidate' },
    ]);
    assert.deepEqual(headers[healthIndex].headers, [
      { key: 'Cache-Control', value: 'no-cache,no-store,must-revalidate' },
      { key: 'Content-Type', value: 'application/json; charset=utf-8' },
    ]);
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

  it('requires an authenticated read-only TTL policy snapshot for both shared-deck collections', () => {
    const workflow = read('.github/workflows/migrate-legacy-shared-decks.yml');
    const setupGcloudIndex = workflow.indexOf('google-github-actions/setup-gcloud@');
    const ttlStepIndex = workflow.indexOf('name: Verify required Firestore TTL policies');
    const ttlCommandIndex = workflow.indexOf('gcloud firestore fields ttls list');
    const nextStepIndex = workflow.indexOf('\n      - ', ttlStepIndex + 1);
    const ttlStep = workflow.slice(ttlStepIndex, nextStepIndex === -1 ? workflow.length : nextStepIndex);

    expect(setupGcloudIndex).toBeGreaterThan(-1);
    expect(ttlStepIndex).toBeGreaterThan(setupGcloudIndex);
    expect(ttlCommandIndex).toBeGreaterThan(ttlStepIndex);
    expect(ttlStep).toContain('--project="$FIREBASE_PROJECT_ID"');
    expect(ttlStep).toContain('--database="$FIRESTORE_DATABASE_ID"');
    expect(ttlStep).toContain('artifacts/index-preparation/ttl-policies.json');
    expect(ttlStep).toContain('shared_decks');
    expect(ttlStep).toContain('shared_deck_owners');
    expect(ttlStep).toContain('"ACTIVE"');
    expect(ttlStep).not.toContain('--enable-ttl');
    expect(workflow).toContain('firestore-ttl-policy-${{ inputs.revision }}');
  });

  it('validates the gcloud TTL snapshot state from ttlConfig', () => {
    const workflow = read('.github/workflows/migrate-legacy-shared-decks.yml');
    const ttlStepStart = workflow.indexOf('name: Verify required Firestore TTL policies');
    const ttlStepEnd = workflow.indexOf('\n      - name:', ttlStepStart + 1);
    const ttlStep = workflow.slice(ttlStepStart, ttlStepEnd === -1 ? workflow.length : ttlStepEnd);
    const snapshot = JSON.stringify([
      {
        name: 'projects/demo/databases/(default)/collectionGroups/shared_decks/fields/expiresAt',
        ttlConfig: { state: 'ACTIVE' },
      },
    ]);
    const jq = 'any(.[]?; ((.name // "") | endswith("/collectionGroups/\\($collection)/fields/expiresAt")) and ((.ttlConfig.state // "") == "ACTIVE"))';

    expect(ttlStep).toContain('(.ttlConfig.state // "") == "ACTIVE"');
    expect(ttlStep).not.toContain('(.state // "") == "ACTIVE"');
    expect(
      execFileSync('jq', ['-e', '--arg', 'collection', 'shared_decks', jq], {
        input: snapshot,
        encoding: 'utf8',
      }),
    ).toContain('true');
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

  it('does not declare composites duplicated by automatic single-field indexes', () => {
    const manifest = JSON.parse(read('firestore.indexes.json'));
    const incidentFields = [
      { fieldPath: 'normalizedWord', order: 'ASCENDING' },
      { fieldPath: 'nextReviewDate', order: 'ASCENDING' },
    ];
    const isRedundantIncidentIndex = index => {
      if (index?.collectionGroup !== 'cards' || index?.queryScope !== 'COLLECTION'
        || !Array.isArray(index?.fields)) return false;
      const [field, documentName] = index.fields;
      return incidentFields.some(incidentField => (
        field?.fieldPath === incidentField.fieldPath
        && field?.order === incidentField.order
        && (index.fields.length === 1
          || (index.fields.length === 2
            && documentName?.fieldPath === '__name__'
            && documentName.order === incidentField.order))
      ));
    };

    assert.ok(Array.isArray(manifest.indexes));
    assert.equal(manifest.indexes.some(isRedundantIncidentIndex), false);
    for (const field of incidentFields) {
      const base = { collectionGroup: 'cards', queryScope: 'COLLECTION' };
      assert.equal(isRedundantIncidentIndex({ ...base, fields: [field] }), true);
      assert.equal(isRedundantIncidentIndex({
        ...base,
        fields: [field, { fieldPath: '__name__', order: field.order }],
      }), true);
      assert.equal(isRedundantIncidentIndex({
        ...base,
        fields: [field, { fieldPath: '__name__', order: 'DESCENDING' }],
      }), false);
    }
  });

  it('only seals an index report after active field and operation readback', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingoflash-index-report-'));
    try {
      const indexes = { fieldOverrides: [{ collectionGroup: 'shared_decks', fieldPath: 'cards', indexes: [] }] };
      fs.writeFileSync(path.join(directory, 'indexes.json'), JSON.stringify(indexes));
      fs.writeFileSync(path.join(directory, 'database.json'), JSON.stringify({ databaseEdition: 'STANDARD' }));
      fs.writeFileSync(path.join(directory, 'operations.json'), JSON.stringify([{ name: 'operations/1', done: true }]));
      fs.writeFileSync(path.join(directory, 'baseline.json'), '[]');
      for (const indexConfig of [
        {
          ancestorField: 'projects/project/databases/database/collectionGroups/__default__/fields/*',
          usesAncestorConfig: false,
        },
        { usesAncestorConfig: false, indexes: [] },
        { ancestorField: 'projects/project/databases/database/collectionGroups/__default__/fields/*' },
      ]) {
        fs.writeFileSync(path.join(directory, 'active.json'), JSON.stringify([{
          collectionGroup: 'shared_decks', fieldPath: 'cards', indexConfig,
        }]));
        execFileSync(process.execPath, ['scripts/verify-firestore-index-preparation.mjs',
          '--indexes', path.join(directory, 'indexes.json'), '--active', path.join(directory, 'active.json'),
          '--database-metadata', path.join(directory, 'database.json'),
          '--operations', path.join(directory, 'operations.json'), '--baseline-operations', path.join(directory, 'baseline.json'),
          '--target', 'project/database',
          '--revision', 'a'.repeat(40), '--output', path.join(directory, 'report.json')], { stdio: 'pipe' });
      }
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
      for (const field of [
        {
          collectionGroup: 'shared_decks', fieldPath: 'cards',
          indexConfig: {
            ancestorField: 'projects/project/databases/database/collectionGroups/__default__/fields/*',
            usesAncestorConfig: true, indexes: [],
          },
        },
        {
          collectionGroup: 'shared_decks', fieldPath: 'cards',
          indexConfig: {
            ancestorField: 'projects/project/databases/database/collectionGroups/__default__/fields/*',
            usesAncestorConfig: false, indexes: [], reverting: true,
          },
        },
        {
          collectionGroup: 'shared_decks', fieldPath: 'cards',
          indexConfig: {
            ancestorField: 'projects/project/databases/database/collectionGroups/__default__/fields/*',
            usesAncestorConfig: false, indexes: null,
          },
        },
        {
          collectionGroup: 'shared_decks', fieldPath: 'cards',
          indexConfig: {
            ancestorField: 'projects/project/databases/database/collectionGroups/__default__/fields/*',
            usesAncestorConfig: false, indexes: {},
          },
        },
        {
          collectionGroup: 'shared_decks', fieldPath: 'cards',
          indexConfig: {
            ancestorField: 'projects/other/databases/database/collectionGroups/__default__/fields/*',
          },
        },
        {
          collectionGroup: 'shared_decks', fieldPath: 'cards',
          indexConfig: {
            ancestorField: 'projects/project/databases/database/collectionGroups/__default__/fields/*',
            usesAncestorConfig: 'true',
          },
        },
        {
          collectionGroup: 'shared_decks', fieldPath: 'cards',
          indexConfig: {
            ancestorField: 'projects/project/databases/database/collectionGroups/__default__/fields/*',
            reverting: 'true',
          },
        },
        { collectionGroup: 'shared_decks', fieldPath: 'cards', indexes: [] },
        { collectionGroup: 'shared_decks', fieldPath: 'cards', indexConfig: {} },
      ]) {
        fs.writeFileSync(path.join(directory, 'active.json'), JSON.stringify([field]));
        assert.throws(() => execFileSync(process.execPath, ['scripts/verify-firestore-index-preparation.mjs',
          '--indexes', path.join(directory, 'indexes.json'), '--active', path.join(directory, 'active.json'),
          '--database-metadata', path.join(directory, 'database.json'),
          '--operations', path.join(directory, 'operations.json'), '--baseline-operations', path.join(directory, 'baseline.json'),
          '--target', 'project/database',
          '--revision', 'a'.repeat(40), '--output', path.join(directory, 'report.json')], { stdio: 'pipe' }));
      }
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

  it('requires every candidate composite index to be an exact READY target-bound record', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingoflash-composite-index-'));
    try {
      const candidate = {
        indexes: [{
          collectionGroup: 'cards',
          queryScope: 'COLLECTION',
          fields: [
            { fieldPath: 'tags', arrayConfig: 'CONTAINS' },
            { fieldPath: 'createdAt', order: 'DESCENDING' },
            { fieldPath: '__name__', order: 'DESCENDING' },
          ],
        }],
        fieldOverrides: [],
      };
      const write = (name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value));
      write('indexes.json', candidate);
      write('active-fields.json', []);
      write('database.json', { databaseEdition: 'STANDARD' });
      write('operations.json', []);
      write('baseline.json', []);
      const verify = active => {
        write('active-composite.json', active);
        return () => execFileSync(process.execPath, ['scripts/verify-firestore-index-preparation.mjs',
          '--indexes', path.join(directory, 'indexes.json'),
          '--composite', path.join(directory, 'active-composite.json'),
          '--active', path.join(directory, 'active-fields.json'),
          '--database-metadata', path.join(directory, 'database.json'),
          '--operations', path.join(directory, 'operations.json'),
          '--baseline-operations', path.join(directory, 'baseline.json'),
          '--target', 'demo/(default)', '--revision', 'a'.repeat(40),
          '--output', path.join(directory, 'report.json')], { stdio: 'pipe' });
      };
      const base = {
        name: 'projects/demo/databases/(default)/collectionGroups/cards/indexes/abc',
        queryScope: 'collection',
        fields: candidate.indexes[0].fields,
      };
      assert.throws(verify([]));
      assert.throws(verify([{ ...base, state: 'CREATING' }]));
      assert.throws(verify([{ ...base, name: 'projects/other/databases/(default)/collectionGroups/cards/indexes/abc', state: 'READY' }]));
      verify([{ ...base, state: 'READY' }])();
      const report = JSON.parse(fs.readFileSync(path.join(directory, 'report.json'), 'utf8'));
      assert.equal(report.active, true);
      assert.equal(report.compositeCount, 1);
      assert.equal(report.target, 'demo/(default)');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
