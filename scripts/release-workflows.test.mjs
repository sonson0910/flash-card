import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = relativePath => fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');

describe('release workflow contracts', () => {
  it('uploads the exact release build verified by the candidate workflow', () => {
    const workflow = read('.github/workflows/release-candidate.yml');
    const functionsPackage = JSON.parse(read('functions/package.json'));
    expect(workflow).toContain('npm run verify:release-config');
    expect(workflow).toContain('npm run verify');
    expect(workflow).toContain('release-artifact.mjs seal');
    expect(workflow).toContain('artifacts/release-candidate-manifest.json');
    expect(workflow).not.toContain('npm run build:release');
    expect(functionsPackage.scripts.preinstall).not.toMatch(/\.\.[/\\]/);
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
      functionsJob.indexOf('firebase-tools@15.23.0 deploy --only functions'),
    );
    expect(workflow.match(/firebase_project_pattern='\^\[a-z\]\[a-z0-9-\]\{4,28\}\[a-z0-9\]\$'/g)).toHaveLength(2);
    expect(workflow).not.toMatch(/firebase-tools@[^\n]+ deploy --non-interactive\s*$/m);
    expect(workflow).not.toContain('--only firestore');
  });

  it('keeps Firestore Rules behind a separate evidence-bound cutover workflow', () => {
    const workflow = read('.github/workflows/deploy-firestore-rules.yml');
    expect(workflow).toContain('environment: production-rules-cutover');
    expect(workflow).toContain('migration_evidence_run_id:');
    expect(workflow).toContain('migration_evidence_sha256:');
    expect(workflow).toContain('migration_approval_ref:');
    expect(workflow).toContain('rules-cutover-evidence.mjs verify');
    expect(workflow).toContain('--workflow-run-id "${{ inputs.candidate_run_id }}"');
    expect(workflow).toContain('--project-id "$FIREBASE_PROJECT_ID" --database-id "$FIRESTORE_DATABASE_ID"');
    expect(workflow).toContain('ROLLBACK_KMS_KEY_VERSION: ${{ vars.ROLLBACK_KMS_KEY_VERSION }}');
    expect(workflow).toContain('--kms-key-version "$ROLLBACK_KMS_KEY_VERSION"');
    expect(workflow).toContain('--rollback-snapshot-ciphertext-file validated/migration-evidence/rollback-snapshot.enc');
    expect(workflow).not.toContain('rollback-snapshot.json');
    expect(workflow).toContain('test "$candidate_path" = ".github/workflows/release-candidate.yml"');
    expect(workflow).toContain('test "$evidence_path" = ".github/workflows/reservation-migration.yml"');
    expect(workflow.match(/test "\$\(jq -r '\.event' <<<"\$(?:candidate|evidence)_json"\)" = "workflow_dispatch"/g) ?? []).toHaveLength(2);
    expect(workflow).toContain("firebase_project_pattern='^[a-z][a-z0-9-]{4,28}[a-z0-9]$'");
    expect(workflow).toContain("firestore_database_pattern='^(\\(default\\)|[a-z][a-z0-9-]{2,61}[a-z0-9])$'");
    expect(workflow).toContain('promote-config --root validated/candidate --source firebase.json --output firebase.promoted.json --database-id "$FIRESTORE_DATABASE_ID"');
    expect(workflow).toContain('--only firestore:rules');
    expect(workflow).not.toMatch(/--only firestore(?:\s|$)/);
    expect(workflow).not.toMatch(/firebase-tools@[^\n]+ deploy --non-interactive\s*$/m);
  });

  it('binds migration evidence operation to the migration mode and encrypts before cleanup', () => {
    const workflow = read('.github/workflows/reservation-migration.yml');
    expect(workflow).toContain('if [[ "$MIGRATION_MODE" == "final-delta" ]]; then test "$MIGRATION_OPERATION" = "cutover"; fi');
    expect(workflow).toContain('if [[ "$MIGRATION_MODE" == "rollback" ]]; then test "$MIGRATION_OPERATION" = "rollback"; fi');
    expect(workflow).toContain('if [[ "$MIGRATION_MODE" == "dry-run" || "$MIGRATION_MODE" == "apply" ]]; then test "$MIGRATION_OPERATION" = "cutover"; fi');
    const migrationStepStart = workflow.indexOf('      - name: Run migration and encrypt rollback manifest');
    const retentionStepStart = workflow.indexOf('      - name: Retain encrypted apply rollback manifest');
    expect(migrationStepStart).toBeGreaterThanOrEqual(0);
    expect(retentionStepStart).toBeGreaterThan(migrationStepStart);
    const migrationStep = workflow.slice(migrationStepStart, retentionStepStart);
    expect(migrationStep).toContain('node functions/lib/legacyLibraryMigrationOperator.js');
    expect(migrationStep).toContain('gcloud kms encrypt');
    expect(migrationStep).toContain('trap cleanup EXIT');
    expect(migrationStep).toContain('rm -f rollback-snapshot.plain.json');
    expect(migrationStep.indexOf('node functions/lib/legacyLibraryMigrationOperator.js')).toBeLessThan(
      migrationStep.indexOf('gcloud kms encrypt'),
    );
    expect(migrationStep).not.toContain(
      "trap 'rm -f rollback-snapshot.plain.json' EXIT\n          node functions/lib/legacyLibraryMigrationOperator.js",
    );
    expect(workflow).toContain('name: reservation-migration-apply-${{ github.sha }}');
    expect(workflow).toContain('path: |\n            rules-cutover-evidence.json\n            rollback-snapshot.enc');
    expect(workflow).not.toContain('rules-cutover-evidence.json\n            rollback-snapshot.enc\n            rollback-snapshot.plain.json');
  });

  it('does not document a local production deploy bypass', () => {
    const readme = read('README.md');
    expect(readme).not.toContain('npx firebase-tools login');
    expect(readme).not.toMatch(/npx firebase-tools deploy\s*$/m);
  });
});
