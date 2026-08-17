import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = relativePath => fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
const signedPayloadKeys = '["ciphertextSha256","databaseId","enforcementEvidenceSha256","enforcementRunAttempt","enforcementRunId","evidenceAttestationKmsAlgorithm","evidenceAttestationKmsKeyVersion","evidenceAttestationPublicKeySpkiSha256","evidenceSha256","migrationRunAttempt","migrationRunId","ownerCommitment","projectId","revision","rollbackKmsKeyVersion","rollbackSnapshotObject"]';
const finalSignedPayloadKeys = '["ciphertextSha256","databaseId","enforcementEvidenceSha256","enforcementRunAttempt","enforcementRunId","evidenceAttestationKmsAlgorithm","evidenceAttestationKmsKeyVersion","evidenceAttestationPublicKeySpkiSha256","evidenceSha256","migrationCompletedAt","migrationMode","migrationRunAttempt","migrationRunId","ownerCommitment","projectId","revision","rollbackKmsKeyVersion","rollbackSnapshotObject"]';
const mutatingProductionWorkflows = [
  '.github/workflows/deploy-firestore-compatibility.yml',
  '.github/workflows/deploy-production.yml',
  '.github/workflows/deploy-firestore-enforcement.yml',
  '.github/workflows/reservation-migration.yml',
  '.github/workflows/deploy-firestore-rules.yml',
];
const retryableIntermediateArtifacts = [
  ['.github/workflows/deploy-firestore-compatibility.yml', 'validated-firestore-compatibility-${{ github.run_id }}'],
  ['.github/workflows/deploy-production.yml', 'validated-candidate-${{ github.run_id }}'],
  ['.github/workflows/deploy-production.yml', 'validated-compatibility-evidence-${{ github.run_id }}'],
  ['.github/workflows/deploy-firestore-enforcement.yml', 'validated-firestore-enforcement-${{ github.run_id }}'],
  ['.github/workflows/deploy-firestore-rules.yml', 'validated-rules-cutover-${{ github.run_id }}'],
];

const expectMainAncestryGuard = (job, revisionVariable, nextStep) => {
  expect(job).toContain('ref: ${{ inputs.revision }}');
  expect(job).toContain('fetch-depth: 0');
  expect(job).toContain('test "$GITHUB_REF" = "refs/heads/main"');
  expect(job).toContain('git fetch --no-tags origin main');
  expect(job).toContain(`test "$(git rev-parse HEAD)" = "${revisionVariable}"`);
  expect(job).toContain(`git merge-base --is-ancestor "${revisionVariable}" origin/main`);
  expect(job.indexOf('actions/checkout@')).toBeLessThan(job.indexOf('Verify checked-out main ancestry'));
  expect(job.indexOf('Verify checked-out main ancestry')).toBeLessThan(job.indexOf(nextStep));
};

const expectVerifyOnlySignatureContract = (
  workflow,
  { schemaVersion = 3, payloadKeys = signedPayloadKeys } = {},
) => {
  const domain = schemaVersion === 3
    ? 'sonflash.reservation-migration-authorization-attestation'
    : 'sonflash.reservation-migration-final-attestation';
  expect(workflow).toContain(
    `jq -e '.domain == "${domain}" and .schemaVersion == ${schemaVersion} and (.schemaVersion | type) == "number"' "$attestation_file" >/dev/null`,
  );
  expect(workflow).toContain(`test "$(jq -cS '.payload | keys' "$attestation_file")" = '${payloadKeys}'`);
  expect(workflow).toContain("jq -cS '.payload' \"$attestation_file\" > \"$attestation_payload\"");
  expect(workflow).toContain("jq -cS '{domain,schemaVersion,payload}' \"$attestation_file\" > \"$attestation_signed\"");
  expect(workflow).toContain("test \"$(jq -r '.evidenceAttestationKmsKeyVersion' \"$attestation_payload\")\" = \"$reviewed_kms_key_version\"");
  expect(workflow).toContain("test \"$(jq -r '.evidenceAttestationKmsAlgorithm' \"$attestation_payload\")\" = \"$reviewed_kms_algorithm\"");
  expect(workflow).toContain("test \"$(jq -r '.evidenceAttestationPublicKeySpkiSha256' \"$attestation_payload\")\" = \"$reviewed_kms_fingerprint\"");
  expect(workflow).toContain('case "$reviewed_kms_algorithm" in');
  expect(workflow).toContain('EC_SIGN_P256_SHA256)');
  expect(workflow).toContain('RSA_SIGN_PKCS1_2048_SHA256|RSA_SIGN_PKCS1_3072_SHA256|RSA_SIGN_PKCS1_4096_SHA256)');
  expect(workflow).toContain('-sigopt rsa_padding_mode:pkcs1');
  expect(workflow).toContain('"$attestation_signed"');
  expect(workflow).toContain('Unsupported evidence attestation KMS algorithm.');
  expect(workflow).not.toContain('asymmetric-sign');
  expect(workflow).not.toContain('id-token: write');
  expect(workflow).not.toContain('EVIDENCE_ATTESTATION_KMS_ALGORITHM: ${{');
  expect(workflow).not.toContain('EVIDENCE_ATTESTATION_PUBLIC_KEY_SPKI_SHA256: ${{');
  expect(workflow).not.toMatch(/(?:vars|secrets|inputs)\.EVIDENCE_ATTESTATION_(?:KMS_ALGORITHM|PUBLIC_KEY_SPKI_SHA256)/);
};

describe('release workflow trust-root contracts', () => {
  it('serializes every production mutation under one non-cancelling provenance lock', () => {
    for (const path of mutatingProductionWorkflows) {
      const workflow = read(path);
      expect(workflow).toContain('concurrency:\n  group: production-release-provenance\n  cancel-in-progress: false');
    }
  });

  it('overwrites only disposable run-scoped handoff artifacts on failed-job retries', () => {
    for (const [path, artifactName] of retryableIntermediateArtifacts) {
      const workflow = read(path);
      const artifactNameIndex = workflow.indexOf(`name: ${artifactName}`);
      const uploadIndex = workflow.lastIndexOf('actions/upload-artifact@', artifactNameIndex);
      const uploadBlock = workflow.slice(uploadIndex, workflow.indexOf('\n\n', artifactNameIndex));

      expect(artifactNameIndex).toBeGreaterThan(-1);
      expect(uploadIndex).toBeGreaterThan(-1);
      expect(artifactName).not.toContain('github.run_attempt');
      expect(uploadBlock).toContain('overwrite: true');
    }
  });

  it('seals and retains the reviewed trust root in the release candidate', () => {
    const workflow = read('.github/workflows/release-candidate.yml');

    expect(workflow).toContain('npm run verify:release-config');
    expect(workflow).toContain('npm run verify');
    expect(workflow).toContain('release-artifact.mjs seal');
    expect(workflow).toContain('evidence-attestation-trust-root.json');
    expect(workflow).toContain('firestore.compatibility.rules');
    expect(workflow).toContain('artifacts/release-candidate-manifest.json');
    expect(workflow).not.toContain('npm run build:release');
  });

  it('validates the exact current-main revision before protected candidate access', () => {
    const workflow = read('.github/workflows/release-candidate.yml');
    const validateJob = workflow.slice(workflow.indexOf('  validate_source:'), workflow.indexOf('  build:'));
    const buildJob = workflow.slice(workflow.indexOf('  build:'));

    expect(workflow).toContain('workflow_dispatch:\n    inputs:\n      revision:');
    expect(validateJob).not.toContain('environment:');
    expect(validateJob).not.toContain('secrets.');
    expect(buildJob).toContain('needs: validate_source');
    expect(buildJob).toContain('environment: production');
    expect(workflow.match(/ref: \$\{\{ inputs\.revision \}\}/g) ?? []).toHaveLength(2);
    expect(workflow.match(/fetch-depth: 0/g) ?? []).toHaveLength(2);
    expect(workflow.match(/test "\$GITHUB_REF" = "refs\/heads\/main"/g) ?? []).toHaveLength(2);
    expect(workflow.match(/test "\$GITHUB_SHA" = "\$RELEASE_REVISION"/g) ?? []).toHaveLength(2);
    expect(workflow.match(/git fetch --no-tags origin main/g) ?? []).toHaveLength(2);
    expect(workflow.match(/git merge-base --is-ancestor "\$RELEASE_REVISION" origin\/main/g) ?? []).toHaveLength(2);
    expect(workflow.match(/git status --porcelain=v1 --untracked-files=all/g) ?? []).toHaveLength(2);
    expect(buildJob.indexOf('Re-verify protected release source')).toBeLessThan(
      buildJob.indexOf('actions/setup-node@'),
    );
    expect(workflow).toContain('RELEASE_REVISION: ${{ inputs.revision }}');
    expect(workflow).toContain('--revision "${{ inputs.revision }}"');
    expect(workflow).toContain('--workflow-run-id "${{ github.run_id }}"');
    expect(workflow).toContain('--workflow-run-attempt "${{ github.run_attempt }}"');
    expect(workflow).toContain('name: lingoflash-${{ inputs.revision }}-${{ github.run_id }}-${{ github.run_attempt }}');
    expect(workflow).toContain('name: browser-evidence-${{ inputs.revision }}-${{ github.run_id }}-${{ github.run_attempt }}');
    expect(workflow).not.toContain('${{ github.sha }}');
  });

  it('binds every candidate consumer to the exact successful source attempt', () => {
    const consumers = [
      '.github/workflows/deploy-production.yml',
      '.github/workflows/deploy-firestore-compatibility.yml',
      '.github/workflows/deploy-firestore-enforcement.yml',
      '.github/workflows/deploy-firestore-rules.yml',
    ];

    for (const path of consumers) {
      const workflow = read(path);
      expect(workflow).toContain('candidate_run_attempt:');
      expect(workflow).toContain('CANDIDATE_RUN_ATTEMPT: ${{ inputs.candidate_run_attempt }}');
      expect(workflow).toContain('/actions/runs/${CANDIDATE_RUN_ID}/attempts/${CANDIDATE_RUN_ATTEMPT}');
      expect(workflow).toContain(`test "$(jq -r '.run_attempt'`);
      expect(workflow).toContain('= "$CANDIDATE_RUN_ATTEMPT"');
      expect(workflow).toContain('name: lingoflash-${{ inputs.revision }}-${{ inputs.candidate_run_id }}-${{ inputs.candidate_run_attempt }}');
      expect(workflow).toContain('--workflow-run-attempt');
    }
  });

  it('keeps Hosting and Functions promotion separate from Firestore Rules', () => {
    const workflow = read('.github/workflows/deploy-production.yml');
    const validateJob = workflow.slice(workflow.indexOf('  validate_candidate:'), workflow.indexOf('  deploy_hosting:'));
    const hostingJob = workflow.slice(workflow.indexOf('  deploy_hosting:'), workflow.indexOf('  deploy_functions:'));
    const functionsJob = workflow.slice(workflow.indexOf('  deploy_functions:'), workflow.indexOf('  record_deployment:'));
    const functionsDeployStep = functionsJob.slice(
      functionsJob.indexOf('      - name: Promote only the sealed Functions artifact after App Check approval'),
      functionsJob.indexOf('      - name: Verify live Hosting and Functions provider provenance'),
    );
    const recordJob = workflow.slice(workflow.indexOf('  record_deployment:'));

    expect(workflow).toContain('actions/download-artifact@');
    expect(workflow.match(/--workflow-run-id "\$CANDIDATE_RUN_ID"/g) ?? []).toHaveLength(3);
    expect(workflow.match(/--workflow-run-attempt "\$CANDIDATE_RUN_ATTEMPT"/g) ?? []).toHaveLength(3);
    expect(workflow).toContain('test "$(jq -r \'.path\' <<<"$candidate_json")" = ".github/workflows/release-candidate.yml"');
    expect(workflow).toContain('--only hosting');
    expect(hostingJob).toContain('--message "sonflash:v1:revision=$SONFLASH_RELEASE_REVISION:candidate=$SONFLASH_RELEASE_CANDIDATE_SHA256"');
    expect(hostingJob).toContain('SONFLASH_RELEASE_REVISION: ${{ inputs.revision }}');
    expect(hostingJob).toContain('SONFLASH_RELEASE_CANDIDATE_SHA256: ${{ inputs.candidate_sha256 }}');
    expect(workflow).toContain('--only functions');
    expect(functionsJob).toContain('SONFLASH_RELEASE_REVISION: ${{ inputs.revision }}');
    expect(functionsJob).toContain('SONFLASH_RELEASE_CANDIDATE_SHA256: ${{ inputs.candidate_sha256 }}');
    expect(functionsDeployStep).toContain('parameter_file="functions/.env.${FIREBASE_PROJECT_ID}"');
    expect(functionsDeployStep).toContain('manifest_file="functions/functions.yaml"');
    expect(functionsDeployStep).toContain('for existing in functions/.env functions/.env.local "$parameter_file" "$manifest_file"; do');
    expect(functionsDeployStep).toContain('if [[ -e "$existing" || -L "$existing" ]]');
    expect(functionsDeployStep).toContain('trap cleanup EXIT');
    expect(functionsDeployStep).toContain('functions-release-manifest.mjs create');
    expect(functionsDeployStep).toContain('firebase-tools-functions-release-manifest.mjs');
    expect(functionsDeployStep).toContain('--firebase-tools-version 15.23.0');
    expect(functionsDeployStep).toContain('test "$(stat --format=%a "$manifest_file")" = "600"');
    expect(functionsDeployStep).toContain('umask 077');
    expect(functionsDeployStep).toContain("printf '%s\\n' 'ENFORCE_APP_CHECK=true' > \"$parameter_file\"");
    expect(functionsDeployStep).toContain('test "$(stat --format=%a "$parameter_file")" = "600"');
    expect(functionsDeployStep).toContain('test "$(wc -l < "$parameter_file")" -eq 1');
    expect(functionsDeployStep).toContain("grep -qxF 'ENFORCE_APP_CHECK=true' \"$parameter_file\"");
    expect(functionsDeployStep).toContain('rm -f -- "$parameter_file" "$manifest_file"');
    expect(functionsDeployStep).not.toContain('ENFORCE_APP_CHECK: "true"');
    expect(workflow).not.toContain('ENFORCE_APP_CHECK: "true"');
    expect(functionsDeployStep.indexOf('trap cleanup EXIT')).toBeLessThan(
      functionsDeployStep.indexOf('functions-release-manifest.mjs create'),
    );
    expect(functionsDeployStep.indexOf('functions-release-manifest.mjs create')).toBeLessThan(
      functionsDeployStep.indexOf('firebase-tools-functions-release-manifest.mjs'),
    );
    expect(functionsDeployStep.indexOf('firebase-tools-functions-release-manifest.mjs')).toBeLessThan(
      functionsDeployStep.indexOf("printf '%s\\n' 'ENFORCE_APP_CHECK=true'"),
    );
    expect(functionsDeployStep.indexOf("printf '%s\\n' 'ENFORCE_APP_CHECK=true'")).toBeLessThan(
      functionsDeployStep.indexOf('deploy --only functions'),
    );
    expect(functionsJob).toContain('id: google_auth');
    expect(functionsJob).toContain('token_format: access_token');
    expect(functionsJob).toContain('FIREBASE_HOSTING_SITE_ID: ${{ vars.FIREBASE_HOSTING_SITE_ID }}');
    expect(functionsJob).toContain('GOOGLE_OAUTH_ACCESS_TOKEN: ${{ steps.google_auth.outputs.access_token }}');
    expect(functionsJob).toContain('provider-release-readback.mjs runtime');
    expect(functionsJob).toContain('--functions generateVocabulary,findVocabularyImage,createSharedDeck,loadSharedDeck,revokeSharedDeck,migrateLegacyLibrary');
    expect(functionsJob.indexOf('deploy --only functions')).toBeLessThan(
      functionsJob.indexOf('provider-release-readback.mjs runtime'),
    );
    expect(recordJob).toContain('RUNTIME_PROVIDER_VERIFIED: ${{ needs.deploy_functions.outputs.runtime_provider_verified }}');
    expect(recordJob).toContain('test "$RUNTIME_PROVIDER_VERIFIED" = "true"');
    expect(workflow).not.toContain('--only firestore');
    expect(validateJob).not.toContain('release-artifact.mjs promote-config');
    expectMainAncestryGuard(validateJob, '$DEPLOY_REVISION', 'Verify candidate and compatibility workflow provenance');
    expectMainAncestryGuard(hostingJob, '$DEPLOY_REVISION', 'Re-verify the protected Hosting candidate, predecessor, and target');
    expectMainAncestryGuard(functionsJob, '$DEPLOY_REVISION', 'Re-verify the protected Functions candidate, predecessor, and target');
    expect(hostingJob.indexOf('Verify checked-out main ancestry')).toBeLessThan(
      hostingJob.indexOf('google-github-actions/auth@'),
    );
    expect(functionsJob.indexOf('Verify checked-out main ancestry')).toBeLessThan(
      functionsJob.indexOf('google-github-actions/auth@'),
    );
    expect(hostingJob).toContain('name: deploy_hosting');
    expect(functionsJob).toContain('name: deploy_functions');
    expect(recordJob).toContain('name: record_deployment');
    expect(recordJob).toContain('needs: [validate_candidate, deploy_hosting, deploy_functions]');
    expect(recordJob).toContain("needs.deploy_hosting.result == 'success'");
    expect(recordJob).toContain("needs.deploy_functions.result == 'success'");
    expect(recordJob).toContain('test "$HOSTING_PROJECT_ID" = "$FUNCTIONS_PROJECT_ID"');
    expect(recordJob).toContain('test "$HOSTING_DATABASE_ID" = "$FUNCTIONS_DATABASE_ID"');
    expect(recordJob).toContain('production-deployment-evidence-${{ github.run_id }}-${{ github.run_attempt }}');
    expect(recordJob).toContain('deploymentRunAttempt:$deploymentRunAttempt');
    expect(recordJob).toContain('candidateSha256:$candidateSha256');
    expect(workflow.match(/fetch-depth: 0/g) ?? []).toHaveLength(3);
  });

  it('passes the App Check parameter expression directly to every callable deployment option', () => {
    const source = read('functions/src/index.ts');

    expect(source).toContain("const enforceAppCheck = defineBoolean('ENFORCE_APP_CHECK', {");
    expect(source).toContain('default: true');
    expect(source.match(/\n  enforceAppCheck,\n/g) ?? []).toHaveLength(6);
    expect(source).not.toContain('enforceAppCheck: enforceAppCheck.value()');
    expect(source).not.toContain('enforceAppCheck: false');
  });

  it('requires exact provider-verified compatibility Rules evidence before protected runtime access', () => {
    const workflow = read('.github/workflows/deploy-production.yml');
    const inputs = workflow.slice(workflow.indexOf('    inputs:'), workflow.indexOf('\n\npermissions:'));
    const validateJob = workflow.slice(workflow.indexOf('  validate_candidate:'), workflow.indexOf('  deploy_hosting:'));
    const hostingJob = workflow.slice(workflow.indexOf('  deploy_hosting:'), workflow.indexOf('  deploy_functions:'));
    const functionsJob = workflow.slice(workflow.indexOf('  deploy_functions:'), workflow.indexOf('  record_deployment:'));

    expect(inputs).toContain('compatibility_run_id:');
    expect(inputs).toContain('compatibility_run_attempt:');
    expect(inputs.match(/required: true/g) ?? []).toHaveLength(7);
    expect(validateJob).not.toContain('environment:');
    expect(validateJob).not.toContain('secrets.');
    expect(validateJob).not.toContain('vars.');
    expect(validateJob).toContain('[[ ! "$COMPATIBILITY_RUN_ID" =~ ^[1-9][0-9]{0,19}$ ]]');
    expect(validateJob).toContain('[[ ! "$COMPATIBILITY_RUN_ATTEMPT" =~ ^[1-9][0-9]{0,9}$ ]]');
    expect(validateJob).toContain('/actions/runs/${COMPATIBILITY_RUN_ID}/attempts/${COMPATIBILITY_RUN_ATTEMPT}');
    expect(validateJob).toContain('test "$(jq -r \'.conclusion\' <<<"$compatibility_json")" = "success"');
    expect(validateJob).toContain('test "$(jq -r \'.event\' <<<"$compatibility_json")" = "workflow_dispatch"');
    expect(validateJob).toContain('test "$(jq -r \'.head_sha\' <<<"$compatibility_json")" = "$DEPLOY_REVISION"');
    expect(validateJob).toContain('test "$(jq -r \'.run_attempt\' <<<"$compatibility_json")" = "$COMPATIBILITY_RUN_ATTEMPT"');
    expect(validateJob).toContain('test "$(jq -r \'.path\' <<<"$compatibility_json")" = ".github/workflows/deploy-firestore-compatibility.yml"');
    expect(validateJob).toContain('/actions/runs/${COMPATIBILITY_RUN_ID}/attempts/${COMPATIBILITY_RUN_ATTEMPT}/jobs?per_page=100');
    expect(validateJob).toContain('.name == "deploy_compatibility_rules" and .status == "completed" and .conclusion == "success"');
    expect(validateJob).toContain('.name == "record_compatibility" and .status == "completed" and .conclusion == "success"');
    expect(validateJob).toContain('name: firestore-compatibility-evidence-${{ inputs.compatibility_run_id }}-${{ inputs.compatibility_run_attempt }}');
    expect(validateJob).toContain('run-id: ${{ inputs.compatibility_run_id }}');
    expect(validateJob).toContain('test "$(jq -cS \'keys\' "$evidence")" = \'["candidateRunAttempt","candidateRunId","candidateSha256","compatibilityRulesSha256","compatibilityRunAttempt","compatibilityRunId","databaseId","projectId","providerVerified","recordedAt","revision","schemaVersion"]\'');
    expect(validateJob).toContain('jq -e \'.schemaVersion == 1 and (.schemaVersion | type) == "number" and .providerVerified == true\' "$evidence" >/dev/null');
    expect(validateJob).toContain('test "$(jq -r \'.candidateRunId\' "$evidence")" = "$CANDIDATE_RUN_ID"');
    expect(validateJob).toContain('test "$(jq -r \'.candidateRunAttempt\' "$evidence")" = "$CANDIDATE_RUN_ATTEMPT"');
    expect(validateJob).toContain('test "$(jq -r \'.candidateSha256\' "$evidence")" = "$CANDIDATE_SHA256"');
    expect(validateJob).toContain('test "$(jq -r \'.compatibilityRunId\' "$evidence")" = "$COMPATIBILITY_RUN_ID"');
    expect(validateJob).toContain('test "$(jq -r \'.compatibilityRunAttempt\' "$evidence")" = "$COMPATIBILITY_RUN_ATTEMPT"');
    expect(validateJob).toContain('test "$(jq -r \'.compatibilityRulesSha256\' "$evidence")" = "$compatibility_rules_sha256"');
    expect(validateJob).toContain('name: validated-compatibility-evidence-${{ github.run_id }}');
    expect(validateJob.indexOf('Verify candidate and compatibility workflow provenance')).toBeLessThan(
      validateJob.indexOf('Verify every sealed candidate byte and compatibility predecessor'),
    );

    for (const protectedJob of [hostingJob, functionsJob]) {
      expect(protectedJob).toContain('validate_candidate');
      expect(protectedJob).toContain('name: validated-compatibility-evidence-${{ github.run_id }}');
      expect(protectedJob).toContain('test "$(jq -r \'.providerVerified\' "$evidence")" = "true"');
      expect(protectedJob).toContain('test "$(jq -r \'.projectId\' "$evidence")" = "$FIREBASE_PROJECT_ID"');
      expect(protectedJob).toContain('test "$(jq -r \'.databaseId\' "$evidence")" = "$FIRESTORE_DATABASE_ID"');
      expect(protectedJob).toContain('test "$(jq -r \'.compatibilityRulesSha256\' "$evidence")" = "$(sha256sum candidate/firestore.compatibility.rules | cut -d \' \' -f 1)"');
      expect(protectedJob.indexOf('validated-compatibility-evidence-${{ github.run_id }}')).toBeLessThan(
        protectedJob.indexOf('google-github-actions/auth@'),
      );
    }
  });

  it('deploys the sealed compatibility Rules only after exact-source validation and approval', () => {
    const workflow = read('.github/workflows/deploy-firestore-compatibility.yml');
    const validateJob = workflow.slice(
      workflow.indexOf('  validate_candidate:'),
      workflow.indexOf('  deploy_compatibility_rules:'),
    );
    const deployJob = workflow.slice(
      workflow.indexOf('  deploy_compatibility_rules:'),
      workflow.indexOf('  record_compatibility:'),
    );
    const recordJob = workflow.slice(workflow.indexOf('  record_compatibility:'));

    expect(workflow).toContain('group: production-release-provenance');
    expect(validateJob).not.toContain('environment:');
    expect(validateJob).not.toContain('secrets.');
    expect(validateJob).not.toContain('vars.');
    expect(deployJob).toContain('needs: validate_candidate');
    expect(deployJob).toContain('environment: production-rules-cutover');
    expect(workflow.match(/test "\$GITHUB_REF" = "refs\/heads\/main"/g) ?? []).toHaveLength(2);
    expect(workflow.match(/test "\$REVISION" = "\$GITHUB_SHA"/g) ?? []).toHaveLength(2);
    expect(workflow.match(/git fetch --no-tags origin main/g) ?? []).toHaveLength(2);
    expect(workflow.match(/git merge-base --is-ancestor "\$REVISION" origin\/main/g) ?? []).toHaveLength(2);
    expect(workflow.match(/git status --porcelain --untracked-files=all/g) ?? []).toHaveLength(2);
    expect(workflow).toContain('test "$(jq -r \'.path\' <<<"$run_json")" = ".github/workflows/release-candidate.yml"');
    expect(workflow.match(/release-artifact\.mjs verify/g) ?? []).toHaveLength(2);
    expect(workflow.match(/sha256sum candidate\/firestore\.compatibility\.rules/g) ?? []).toHaveLength(2);
    expect(workflow.match(/cmp --silent firestore\.compatibility\.rules candidate\/firestore\.compatibility\.rules/g) ?? []).toHaveLength(2);
    expect(workflow).toContain('--firestore-rules firestore.compatibility.rules');
    expect(workflow).toContain('--only firestore:rules');
    expect(workflow).not.toMatch(/--only firestore(?:\s|$)/);
    expect(workflow).not.toContain('migration_evidence');
    expect(deployJob.indexOf('Re-verify protected compatibility artifact and target')).toBeLessThan(
      deployJob.indexOf('google-github-actions/auth@'),
    );
    expect(deployJob).toContain('id: google_auth');
    expect(deployJob).toContain('token_format: access_token');
    expect(deployJob).toContain('GOOGLE_OAUTH_ACCESS_TOKEN: ${{ steps.google_auth.outputs.access_token }}');
    expect(deployJob).toContain('provider-release-readback.mjs rules');
    expect(deployJob).toContain('--rules-file candidate/firestore.compatibility.rules');
    expect(deployJob.indexOf('Deploy only the sealed preparatory compatibility Rules')).toBeLessThan(
      deployJob.indexOf('Verify active compatibility Rules provider provenance'),
    );
    expect(recordJob).toContain('name: record_compatibility');
    expect(recordJob).toContain('needs: [validate_candidate, deploy_compatibility_rules]');
    expect(recordJob).toContain('PROVIDER_VERIFIED: ${{ needs.deploy_compatibility_rules.outputs.provider_verified }}');
    expect(recordJob).toContain('test "$PROVIDER_VERIFIED" = "true"');
    expect(recordJob).toContain('firestore-compatibility-evidence-${{ github.run_id }}-${{ github.run_attempt }}');
    expect(recordJob).toContain('providerVerified:true');
  });

  it('deploys the sealed strict mutation fence only after the compatible runtime', () => {
    const workflow = read('.github/workflows/deploy-firestore-enforcement.yml');
    const validateJob = workflow.slice(
      workflow.indexOf('  validate_candidate:'),
      workflow.indexOf('  deploy_enforcement_rules:'),
    );
    const deployJob = workflow.slice(
      workflow.indexOf('  deploy_enforcement_rules:'),
      workflow.indexOf('  record_enforcement:'),
    );
    const recordJob = workflow.slice(workflow.indexOf('  record_enforcement:'));

    expect(workflow).toContain('group: production-release-provenance');
    expect(validateJob).not.toContain('environment:');
    expect(validateJob).not.toContain('secrets.');
    expect(validateJob).not.toContain('vars.');
    expect(deployJob).toContain('needs: validate_candidate');
    expect(deployJob).toContain('environment: production-rules-cutover');
    expect(workflow.match(/test "\$GITHUB_REF" = "refs\/heads\/main"/g) ?? []).toHaveLength(3);
    expect(workflow.match(/test "\$REVISION" = "\$GITHUB_SHA"/g) ?? []).toHaveLength(3);
    expect(workflow.match(/git fetch --no-tags origin main/g) ?? []).toHaveLength(2);
    expect(workflow.match(/git status --porcelain --untracked-files=all/g) ?? []).toHaveLength(2);
    expect(workflow).toContain('test "$(jq -r \'.path\' <<<"$candidate_json")" = ".github/workflows/release-candidate.yml"');
    expect(workflow).toContain('test "$(jq -r \'.path\' <<<"$deployment_json")" = ".github/workflows/deploy-production.yml"');
    expect(workflow).toContain('.name == "deploy_hosting" and .status == "completed" and .conclusion == "success"');
    expect(workflow).toContain('.name == "deploy_functions" and .status == "completed" and .conclusion == "success"');
    expect(workflow).toContain('.name == "record_deployment" and .status == "completed" and .conclusion == "success"');
    expect(workflow.match(/release-artifact\.mjs verify/g) ?? []).toHaveLength(2);
    expect(workflow.match(/sha256sum (?:candidate|validated\/candidate)\/firestore\.rules/g) ?? []).toHaveLength(2);
    expect(workflow.match(/cmp --silent firestore\.rules (?:candidate|validated\/candidate)\/firestore\.rules/g) ?? []).toHaveLength(2);
    expect(workflow).toContain('production-deployment-evidence-${{ inputs.production_deploy_run_id }}-${{ inputs.production_deploy_run_attempt }}');
    expect(workflow).toContain('--only firestore:rules');
    expect(workflow).not.toContain('--firestore-rules firestore.compatibility.rules');
    expect(workflow).not.toContain('migration_evidence');
    expect(deployJob.indexOf('Re-verify protected strict artifact, runtime evidence, and target')).toBeLessThan(
      deployJob.indexOf('google-github-actions/auth@'),
    );
    expect(deployJob).toContain('id: google_auth');
    expect(deployJob).toContain('token_format: access_token');
    expect(deployJob).toContain('GOOGLE_OAUTH_ACCESS_TOKEN: ${{ steps.google_auth.outputs.access_token }}');
    expect(deployJob).toContain('provider-release-readback.mjs rules');
    expect(deployJob).toContain('--rules-file validated/candidate/firestore.rules');
    expect(deployJob.indexOf('Deploy only the sealed strict Firestore Rules')).toBeLessThan(
      deployJob.indexOf('Verify active strict Rules provider provenance'),
    );
    expect(recordJob).toContain('name: record_enforcement');
    expect(recordJob).toContain('needs: [validate_candidate, deploy_enforcement_rules]');
    expect(recordJob).toContain("needs.deploy_enforcement_rules.result == 'success'");
    expect(recordJob).toContain('PROVIDER_VERIFIED: ${{ needs.deploy_enforcement_rules.outputs.provider_verified }}');
    expect(recordJob).toContain('test "$PROVIDER_VERIFIED" = "true"');
    expect(workflow.match(/validated-firestore-enforcement-\$\{\{ github\.run_id \}\}/g) ?? []).toHaveLength(3);
    expect(workflow).not.toContain('validated-firestore-enforcement-${{ github.run_id }}-${{ github.run_attempt }}');
    expect(recordJob).toContain('firestore-enforcement-evidence-${{ github.run_id }}-${{ github.run_attempt }}');
    expect(recordJob).toContain('firestore-enforcement-evidence.mjs verify');
    expect(recordJob.indexOf('actions/download-artifact@')).toBeLessThan(
      recordJob.indexOf('actions/upload-artifact@'),
    );
  });

  it('fails the Rules cutover closed before approval unless main and schema 2 are verified', () => {
    const workflow = read('.github/workflows/deploy-firestore-rules.yml');
    const validateJob = workflow.slice(workflow.indexOf('  validate_evidence:'), workflow.indexOf('  deploy_rules:'));
    const deployJob = workflow.slice(workflow.indexOf('  deploy_rules:'));

    expect(workflow).toContain('environment: production-rules-cutover');
    expect(workflow).toContain('test "$GITHUB_REF" = "refs/heads/main"');
    expect(workflow.match(/jq -e '\.schemaVersion == 2' "\$manifest" >\/dev\/null/g) ?? []).toHaveLength(2);
    expect(workflow).toContain('production_deploy_run_id:');
    expect(workflow).toContain('production_deploy_run_attempt:');
    expect(workflow).toContain('enforcement_run_id:');
    expect(workflow).toContain('enforcement_run_attempt:');
    expect(workflow).toContain('migration_evidence_run_attempt:');
    expect(workflow).toContain('EVIDENCE_PRODUCER_RUN_ATTEMPT: ${{ inputs.migration_evidence_run_attempt }}');
    expect(workflow).toContain('test "$candidate_path" = ".github/workflows/release-candidate.yml"');
    expect(workflow).toContain('test "$deployment_path" = ".github/workflows/deploy-production.yml"');
    expect(workflow).toContain('test "$evidence_path" = ".github/workflows/reservation-migration.yml"');
    expect(workflow).toContain('/actions/runs/${EVIDENCE_RUN_ID}/attempts/${EVIDENCE_PRODUCER_RUN_ATTEMPT}');
    expect(workflow).toContain('test "$(jq -r \'.run_attempt\' <<<"$evidence_json")" = "$EVIDENCE_PRODUCER_RUN_ATTEMPT"');
    expect(workflow).toContain('/actions/runs/${EVIDENCE_RUN_ID}/attempts/${EVIDENCE_PRODUCER_RUN_ATTEMPT}/jobs?per_page=100');
    expect(workflow).toContain('.name == "attest_final_state" and .status == "completed" and .conclusion == "success"');
    expect(workflow).toContain('reservation-migration-evidence-${{ inputs.revision }}-${{ inputs.migration_evidence_run_id }}-${{ inputs.migration_evidence_run_attempt }}');
    expect(workflow).toContain('/actions/runs/${PRODUCTION_DEPLOY_RUN_ID}/attempts/${PRODUCTION_DEPLOY_RUN_ATTEMPT}');
    expect(workflow).toContain('/actions/runs/${PRODUCTION_DEPLOY_RUN_ID}/attempts/${PRODUCTION_DEPLOY_RUN_ATTEMPT}/jobs?per_page=100');
    expect(workflow).toContain('.name == "deploy_hosting" and .status == "completed" and .conclusion == "success"');
    expect(workflow).toContain('.name == "deploy_functions" and .status == "completed" and .conclusion == "success"');
    expect(workflow).toContain('.name == "record_deployment" and .status == "completed" and .conclusion == "success"');
    expect(workflow).toContain('/actions/runs/${ENFORCEMENT_RUN_ID}/attempts/${ENFORCEMENT_RUN_ATTEMPT}');
    expect(workflow).toContain('test "$(jq -r \'.path\' <<<"$enforcement_json")" = ".github/workflows/deploy-firestore-enforcement.yml"');
    expect(workflow).toContain('.name == "deploy_enforcement_rules" and .status == "completed" and .conclusion == "success"');
    expect(workflow).toContain('.name == "record_enforcement" and .status == "completed" and .conclusion == "success"');
    expect(workflow).toContain('firestore-enforcement-evidence-${{ inputs.enforcement_run_id }}-${{ inputs.enforcement_run_attempt }}');
    expect(workflow.match(/firestore-enforcement-evidence\.mjs verify/g) ?? []).toHaveLength(2);
    expect(workflow).toContain('test "$(jq -r \'.payload.enforcementEvidenceSha256\' "$attestation")" = "$enforcement_evidence_sha256"');
    expect(workflow).toContain('production-deployment-evidence-${{ inputs.production_deploy_run_id }}-${{ inputs.production_deploy_run_attempt }}');
    expect(workflow.match(/production-deployment-evidence\/deployment\.json/g) ?? []).toHaveLength(3);
    expect(workflow).toContain('test "$(jq -r \'.candidateSha256\' "$deployment")" = "$CANDIDATE_SHA256"');
    expect(workflow).toContain('test "$(jq -r \'.projectId\' "$deployment")" = "$FIREBASE_PROJECT_ID"');
    expect(workflow).toContain('test "$(jq -r \'.databaseId\' "$deployment")" = "$FIRESTORE_DATABASE_ID"');
    expect(workflow).toContain('verify-attestation-trust-root --root validated/candidate');
    expect(workflow).toContain('--metadata "$metadata_directory/kms-metadata.json" --public-key "$metadata_directory/attestation-public-key.pem"');
    expect(workflow).toContain('validated/candidate/evidence-attestation-trust-root.json');
    expect(workflow).toContain('test "$EVIDENCE_ATTESTATION_KMS_KEY_VERSION" = "$reviewed_kms_key_version"');
    expect(workflow).toContain("--format='json(name,algorithm)'");
    expect(workflow).toContain('get-public-key "$kms_version"');
    expectVerifyOnlySignatureContract(workflow, {
      schemaVersion: 4,
      payloadKeys: finalSignedPayloadKeys,
    });
    expect(workflow).toContain('test "$(jq -r \'.migrationRunId\' "$attestation_payload")" = "$EVIDENCE_RUN_ID"');
    expect(workflow).toContain("migration_run_attempt=\"$(jq -er '.payload.migrationRunAttempt | select(type == \"number\" and . >= 1)' \"$attestation\")\"");
    expect(workflow).toContain('/attempts/${migration_run_attempt}/jobs?per_page=100');
    expect(workflow).toContain('.jobs | any(.name == "migrate" and .status == "completed" and .conclusion == "success")');
    expect(workflow).toContain('migrationRunAttempt');
    expect(workflow).toContain('evidence_run_attempt: ${{ steps.final_evidence.outputs.migration_run_attempt }}');
    expect(workflow).toContain('test "$migration_run_attempt" = "$EVIDENCE_RUN_ATTEMPT"');
    expect(workflow).not.toContain(".run_attempt | select(type == \"number\" and . >= 1)' <<<\"$evidence_json\"");
    expect(workflow).toContain('--not-before "$migration_completed_at"');
    expect(workflow).toContain('rollback-snapshot-object.mjs download');
    expect(workflow.indexOf('openssl dgst -sha256 -verify')).toBeLessThan(
      workflow.indexOf('rollback-snapshot-object.mjs download'),
    );
    expect(workflow).toContain('migration-evidence/rollback-snapshot-object.json');
    expect(workflow).not.toContain('migration-evidence/rollback-snapshot.enc\n');
    expect(workflow.indexOf('verify-attestation-trust-root')).toBeLessThan(workflow.indexOf('openssl dgst -sha256 -verify'));
    expect(workflow.indexOf('openssl dgst -sha256 -verify')).toBeLessThan(workflow.indexOf('rules-cutover-evidence.mjs verify'));
    expect(workflow).toContain('--only firestore:rules');
    expect(workflow).not.toMatch(/--only firestore(?:\s|$)/);
    expect(deployJob).toContain('id: google_auth');
    expect(deployJob).toContain('token_format: access_token');
    expect(deployJob).toContain('GOOGLE_OAUTH_ACCESS_TOKEN: ${{ steps.google_auth.outputs.access_token }}');
    expect(deployJob).toContain('provider-release-readback.mjs rules');
    expect(deployJob).toContain('--rules-file validated/candidate/firestore.rules');
    expect(deployJob.indexOf('Deploy only the evidence-bound Firestore Rules')).toBeLessThan(
      deployJob.indexOf('Verify active Firestore Rules provider provenance'),
    );
    expectMainAncestryGuard(validateJob, '$REVISION', 'Verify candidate, compatible runtime deployment, and Admin-evidence workflow provenance');
    expectMainAncestryGuard(deployJob, '$REVISION', 'google-github-actions/auth@');
    expect(workflow.match(/fetch-depth: 0/g) ?? []).toHaveLength(2);
  });

  it('separates pre-mutation authorization from externally sealed final-state evidence', () => {
    const workflow = read('.github/workflows/reservation-migration.yml');
    const authorizationGate = workflow.indexOf('name: Verify protected pre-mutation authorization');
    const migration = workflow.indexOf('name: Run bounded owner migration without exporting card data');
    const finalEvidenceGate = workflow.indexOf('name: Verify externally sealed post-mutation final-state evidence');
    const finalJob = workflow.slice(workflow.indexOf('  attest_final_state:'));
    const upload = workflow.indexOf('actions/upload-artifact@');

    expect(workflow).toContain('environment: production-rules-cutover');
    expect(workflow).toContain('test "$GITHUB_REF" = "refs/heads/main"');
    expect(workflow.match(/fetch-depth: 0/g) ?? []).toHaveLength(2);
    expect(workflow.match(/git fetch --no-tags origin main/g) ?? []).toHaveLength(2);
    expect(workflow).toContain('test "$(git rev-parse HEAD)" = "$RELEASE_REVISION"');
    expect(workflow.indexOf('git merge-base --is-ancestor')).toBeLessThan(
      workflow.indexOf('google-github-actions/auth@'),
    );
    expect(workflow).toContain('name: Verify reviewed attestation trust root before migration');
    expect(workflow).toContain('name: Verify reviewed attestation trust root for final evidence');
    expect(workflow).toContain('verify-attestation-trust-root --root .');
    expect(workflow).toContain('--metadata "$metadata_directory/kms-metadata.json" --public-key "$metadata_directory/attestation-public-key.pem"');
    expect(workflow).toContain('MIGRATION_AUTHORIZATION_EVIDENCE_B64');
    expect(workflow).toContain('MIGRATION_AUTHORIZATION_ATTESTATION_B64');
    expect(workflow).toContain('ROLLBACK_SNAPSHOT_OBJECT_DESCRIPTOR_B64');
    expect(workflow).toContain('ROLLBACK_SNAPSHOT_OBJECT_BUCKET');
    expect(workflow).toContain('ROLLBACK_SNAPSHOT_OBJECT_PREFIX');
    expect(workflow).toContain('enforcement_run_id:');
    expect(workflow).toContain('enforcement_run_attempt:');
    expect(workflow).toContain('name: Verify exact strict-enforcement workflow provenance');
    expect(workflow).toContain('name: Re-verify strict-enforcement workflow provenance for final evidence');
    expect(workflow.match(/test "\$\(jq -r '\.event' <<<"\$enforcement_json"\)" = "workflow_dispatch"/g) ?? []).toHaveLength(2);
    expect(workflow.match(/\.name == "record_enforcement" and \.status == "completed" and \.conclusion == "success"/g) ?? []).toHaveLength(2);
    expect(workflow.match(/firestore-enforcement-evidence\.mjs verify/g) ?? []).toHaveLength(2);
    expect(workflow).toContain('enforcement_evidence_sha256: ${{ steps.enforcement.outputs.evidence_sha256 }}');
    expect(workflow).not.toContain('ROLLBACK_SNAPSHOT_CIPHERTEXT_B64');
    expect(workflow).toContain('rollback-snapshot-object.mjs download');
    expect(workflow).toContain('rollback_object_descriptor_sha256: ${{ steps.authorization.outputs.object_descriptor_sha256 }}');
    expect(workflow).toContain('test "$object_descriptor_sha256" = "$ROLLBACK_OBJECT_DESCRIPTOR_SHA256"');
    expect(workflow.indexOf('openssl dgst -sha256 -verify')).toBeLessThan(
      workflow.indexOf('rollback-snapshot-object.mjs download'),
    );
    expect(workflow).toContain('reservation-migration-evidence/rollback-snapshot-object.json');
    expect(workflow).toContain('name: reservation-migration-evidence-${{ inputs.revision }}-${{ github.run_id }}-${{ github.run_attempt }}');
    expect(workflow).not.toContain('reservation-migration-evidence/rollback-snapshot.enc\n');
    expect(workflow).toContain('FINAL_RULES_CUTOVER_EVIDENCE_B64');
    expect(workflow).toContain('FINAL_MIGRATION_EVIDENCE_ATTESTATION_B64');
    expect(workflow).toContain('migration-authorization-evidence.mjs verify');
    expect(workflow).toContain('migration_completed_at: ${{ steps.migration.outputs.completed_at }}');
    expect(workflow).toContain('migration_run_id: ${{ steps.migration.outputs.run_id }}');
    expect(workflow).toContain('migration_run_attempt: ${{ steps.migration.outputs.run_attempt }}');
    expect(workflow).toContain('rollback_ciphertext_sha256: ${{ steps.authorization.outputs.ciphertext_sha256 }}');
    expect(finalJob).toContain('MIGRATION_RUN_ID: ${{ needs.migrate.outputs.migration_run_id }}');
    expect(finalJob).toContain('MIGRATION_RUN_ATTEMPT: ${{ needs.migrate.outputs.migration_run_attempt }}');
    expect(finalJob).not.toContain('MIGRATION_RUN_ATTEMPT: ${{ github.run_attempt }}');
    expect(workflow.match(/MIGRATION_RUN_ATTEMPT: \$\{\{ github\.run_attempt \}\}/g) ?? []).toHaveLength(2);
    expect(workflow).toContain('test "$(jq -r \'.migrationRunId\' "$attestation_payload")" = "$MIGRATION_RUN_ID"');
    expect(workflow).toContain('test "$(jq -r \'.migrationCompletedAt\' "$attestation_payload")" = "$MIGRATION_COMPLETED_AT"');
    expect(workflow).toContain('--not-before "$MIGRATION_COMPLETED_AT"');
    expectVerifyOnlySignatureContract(workflow);
    expect(workflow).toContain(`test "$(jq -cS '.payload | keys' "$attestation_file")" = '${finalSignedPayloadKeys}'`);
    expect(workflow).toContain('migrationRunAttempt');
    expect(workflow).toContain('test "$GITHUB_SHA" = "$RELEASE_REVISION"');
    expect(workflow).toContain('--migration-run-id "$MIGRATION_RUN_ID"');
    expect(workflow).toContain('--migration-run-attempt "$MIGRATION_RUN_ATTEMPT"');
    expect(workflow).toContain('--enforcement-run-id "$ENFORCEMENT_RUN_ID"');
    expect(workflow).toContain('--enforcement-run-attempt "$ENFORCEMENT_RUN_ATTEMPT"');
    expect(workflow).toContain('--enforcement-evidence-sha256 "$ENFORCEMENT_EVIDENCE_SHA256"');
    expect(workflow.match(/test "\$\(jq -r '\.enforcementEvidenceSha256' "\$attestation_payload"\)" = "\$ENFORCEMENT_EVIDENCE_SHA256"/g) ?? []).toHaveLength(2);
    expect(authorizationGate).toBeGreaterThan(-1);
    expect(migration).toBeGreaterThan(authorizationGate);
    expect(finalEvidenceGate).toBeGreaterThan(migration);
    expect(upload).toBeGreaterThan(finalEvidenceGate);
    expect(workflow.indexOf('migration-authorization-evidence.mjs verify')).toBeLessThan(migration);
    expect(workflow.indexOf('rules-cutover-evidence.mjs verify')).toBeGreaterThan(migration);
    expect(workflow.match(/legacyLibraryMigrationOperator\.js/g) ?? []).toHaveLength(1);
  });

  it('keeps the direct repair workflow read-only and revision-bound', () => {
    const workflow = read('.github/workflows/repair-legacy-libraries.yml');
    const inputs = workflow.slice(workflow.indexOf('    inputs:'), workflow.indexOf('\n\npermissions:'));

    expect(workflow).toContain('environment: production-rules-cutover');
    expect(inputs).toContain('revision:');
    expect(inputs).toContain('owner_id:');
    expect(inputs).toContain('owner_key:');
    expect(inputs).not.toContain('mode:');
    expect(inputs).not.toContain('confirmation:');
    expect(workflow).not.toContain('APPLY_QUERY_V2');
    expect(workflow).not.toContain('ROLLBACK_QUERY_V2');
    expect(workflow).toContain('test "$GITHUB_REF" = "refs/heads/main"');
    expect(workflow).toContain('[[ "$RELEASE_REVISION" =~ ^([0-9a-f]{40}|[0-9a-f]{64})$ ]]');
    expect(workflow).toContain('ref: ${{ inputs.revision }}');
    expect(workflow).toContain('fetch-depth: 0');
    expect(workflow).toContain('git fetch --no-tags origin main');
    expect(workflow).toContain('test "$(git rev-parse HEAD)" = "$RELEASE_REVISION"');
    expect(workflow).toContain('git merge-base --is-ancestor "$RELEASE_REVISION" origin/main');
    expect(workflow.indexOf('git merge-base --is-ancestor')).toBeLessThan(
      workflow.indexOf('google-github-actions/auth@'),
    );
    expect(workflow).toContain('MIGRATION_MODE: dry-run');
    expect(workflow).not.toContain('MIGRATION_MODE: ${{ inputs.mode }}');
    expect(workflow).toContain('MIGRATION_OWNER_ID: ${{ inputs.owner_id }}');
    expect(workflow).toContain('MIGRATION_OWNER_KEY: ${{ inputs.owner_key }}');
    expect(workflow).toContain('test "$MIGRATION_OWNER_KEY" = "$expected_owner_key"');
  });

  it('does not document a local production deploy bypass', () => {
    const readme = read('README.md');
    expect(readme).not.toContain('npx firebase-tools login');
    expect(readme).not.toMatch(/npx firebase-tools deploy\s*$/m);
  });
});
