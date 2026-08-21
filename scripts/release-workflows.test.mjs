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

  it('deploys Firestore Rules from only a sealed candidate behind protected approval', () => {
    const workflow = read('.github/workflows/deploy-firestore-rules.yml');
    expect(workflow).toContain('environment: production-rules-cutover');
    expect(workflow).toContain('operation:');
    expect(workflow).toContain('approval_ref:');
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
});
