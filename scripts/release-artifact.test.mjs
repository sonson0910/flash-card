import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createHash, generateKeyPairSync } from 'node:crypto';
import {
  createPromotedFirebaseConfig,
  sealReleaseArtifact,
  verifyEvidenceAttestationTrustRoot,
  verifyReleaseArtifact,
} from './release-artifact.mjs';

const temporaryDirectories = [];
const TRUSTED_KMS_KEY_VERSION = 'projects/project-production/locations/us-central1/keyRings/release/cryptoKeys/evidence-attestation/cryptoKeyVersions/1';
const TRUSTED_KMS_ALGORITHM = 'RSA_SIGN_PKCS1_2048_SHA256';

const createTestKeyPair = () => generateKeyPairSync('rsa', { modulusLength: 2048 });

const fingerprintPublicKey = publicKey => createHash('sha256').update(publicKey.export({
  type: 'spki',
  format: 'der',
})).digest('hex');

const writeTrustRoot = (root, {
  keyVersion = TRUSTED_KMS_KEY_VERSION,
  algorithm = TRUSTED_KMS_ALGORITHM,
  fingerprint = fingerprintPublicKey(trustedKeyPair.publicKey),
  ...overrides
} = {}) => {
  fs.writeFileSync(path.join(root, 'evidence-attestation-trust-root.json'), `${JSON.stringify({
    schemaVersion: 1,
    evidenceAttestationKmsKeyVersion: keyVersion,
    evidenceAttestationKmsAlgorithm: algorithm,
    evidenceAttestationPublicKeySpkiSha256: fingerprint,
    ...overrides,
  })}\n`);
};

const writeKmsVerificationInputs = (root, {
  keyPair = trustedKeyPair,
  name = TRUSTED_KMS_KEY_VERSION,
  algorithm = TRUSTED_KMS_ALGORITHM,
} = {}) => {
  const metadataPath = path.join(root, 'kms-metadata.json');
  const publicKeyPath = path.join(root, 'attestation-public-key.pem');
  fs.writeFileSync(metadataPath, JSON.stringify({ name, algorithm }));
  fs.writeFileSync(publicKeyPath, keyPair.publicKey.export({ type: 'spki', format: 'pem' }));
  return { metadataPath, publicKeyPath };
};

const trustedKeyPair = createTestKeyPair();

const firebaseConfig = (overrides = {}) => ({
  functions: { source: 'functions', predeploy: ['npm run rebuild'] },
  firestore: [{
    database: 'database-production',
    rules: 'firestore.rules',
    indexes: 'firestore.indexes.json',
    predeploy: ['npm run mutate'],
  }],
  hosting: { public: 'dist', predeploy: ['npm run rebuild'] },
  ...overrides,
});

const createCandidate = (revision = 'a'.repeat(40)) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lingoflash-release-artifact-'));
  temporaryDirectories.push(root);
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  fs.mkdirSync(path.join(root, 'functions/lib'), { recursive: true });
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist/index.html'), '<main>release</main>');
  fs.writeFileSync(path.join(root, 'functions/lib/index.js'), 'export const ready = true;');
  fs.writeFileSync(path.join(root, 'functions/lib/runtime-target.json'), JSON.stringify({
    firestoreDatabaseId: 'database-production',
  }));
  fs.writeFileSync(path.join(root, 'functions/package.json'), '{"main":"lib/index.js"}\n');
  fs.writeFileSync(path.join(root, 'functions/package-lock.json'), '{"lockfileVersion":3}\n');
  fs.writeFileSync(path.join(root, 'firestore.rules'), 'rules_version = "2";');
  fs.writeFileSync(
    path.join(root, 'firestore.compatibility.rules'),
    'rules_version = "2"; // compatibility\n',
  );
  fs.writeFileSync(path.join(root, 'firestore.indexes.json'), '{"indexes":[]}\n');
  fs.writeFileSync(path.join(root, 'firebase.json'), `${JSON.stringify(firebaseConfig())}\n`);
  fs.writeFileSync(path.join(root, 'firebase-applet-config.json'), JSON.stringify({
    projectId: 'project-production',
    firestoreDatabaseId: 'database-production',
  }));
  fs.writeFileSync(path.join(root, 'artifacts/phase6-readiness.json'), JSON.stringify({
    revision, releaseEligible: true,
  }));
  writeTrustRoot(root);
  return root;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('sealed release artifact', () => {
  it('binds deployable files and readiness evidence to one revision and digest', () => {
    const root = createCandidate('a'.repeat(40));
    const manifest = sealReleaseArtifact({
      root,
      revision: 'a'.repeat(40),
      workflowRunId: '12345',
      workflowRunAttempt: '2',
      generatedAt: '2026-08-10T00:00:00.000Z',
    });

    expect(manifest).toMatchObject({
      schemaVersion: 2,
      revision: 'a'.repeat(40),
      workflowRunId: '12345',
      workflowRunAttempt: '2',
      generatedAt: '2026-08-10T00:00:00.000Z',
      candidateSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(manifest.components.evidenceAttestationTrustRoot).toMatchObject({
      path: 'evidence-attestation-trust-root.json',
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(manifest.components.firestoreCompatibilityRules).toMatchObject({
      path: 'firestore.compatibility.rules',
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(() => verifyReleaseArtifact({
      root,
      manifest,
      expectedRevision: 'a'.repeat(40),
      expectedWorkflowRunId: '12345',
      expectedWorkflowRunAttempt: '2',
      expectedCandidateSha256: manifest.candidateSha256,
    })).not.toThrow();
  });

  it('rejects a candidate sealed by a different workflow run', () => {
    const root = createCandidate('a'.repeat(40));
    const manifest = sealReleaseArtifact({
      root,
      revision: 'a'.repeat(40),
      workflowRunId: '12345',
      workflowRunAttempt: '2',
      generatedAt: '2026-08-10T00:00:00.000Z',
    });

    expect(() => verifyReleaseArtifact({
      root,
      manifest,
      expectedRevision: 'a'.repeat(40),
      expectedWorkflowRunId: '54321',
      expectedWorkflowRunAttempt: '2',
      expectedCandidateSha256: manifest.candidateSha256,
    })).toThrow(/workflow run/i);
  });

  it('rejects a candidate sealed by a different workflow run attempt', () => {
    const root = createCandidate('a'.repeat(40));
    const manifest = sealReleaseArtifact({
      root,
      revision: 'a'.repeat(40),
      workflowRunId: '12345',
      workflowRunAttempt: '2',
      generatedAt: '2026-08-10T00:00:00.000Z',
    });

    expect(() => verifyReleaseArtifact({
      root,
      manifest,
      expectedRevision: 'a'.repeat(40),
      expectedWorkflowRunId: '12345',
      expectedWorkflowRunAttempt: '3',
      expectedCandidateSha256: manifest.candidateSha256,
    })).toThrow(/run attempt/i);
  });

  it('rejects a modified file after the candidate was sealed', () => {
    const root = createCandidate('b'.repeat(40));
    const manifest = sealReleaseArtifact({
      root,
      revision: 'b'.repeat(40),
      workflowRunId: '56789',
      workflowRunAttempt: '3',
      generatedAt: '2026-08-10T00:00:00.000Z',
    });
    fs.writeFileSync(path.join(root, 'dist/index.html'), '<main>tampered</main>');

    expect(() => verifyReleaseArtifact({
      root,
      manifest,
      expectedRevision: 'b'.repeat(40),
      expectedWorkflowRunId: '56789',
      expectedWorkflowRunAttempt: '3',
      expectedCandidateSha256: manifest.candidateSha256,
    })).toThrow(/dist/);
  });

  it('rejects a protected deployment target that differs from the sealed client project or database', () => {
    const root = createCandidate('b'.repeat(40));
    const manifest = sealReleaseArtifact({
      root,
      revision: 'b'.repeat(40),
      workflowRunId: '56789',
      workflowRunAttempt: '3',
      generatedAt: '2026-08-10T00:00:00.000Z',
    });

    expect(() => verifyReleaseArtifact({
      root,
      manifest,
      expectedRevision: 'b'.repeat(40),
      expectedWorkflowRunId: '56789',
      expectedWorkflowRunAttempt: '3',
      expectedCandidateSha256: manifest.candidateSha256,
      expectedProjectId: 'other-production-project',
      expectedDatabaseId: 'database-production',
    })).toThrow(/project/i);
    expect(() => verifyReleaseArtifact({
      root,
      manifest,
      expectedRevision: 'b'.repeat(40),
      expectedWorkflowRunId: '56789',
      expectedWorkflowRunAttempt: '3',
      expectedCandidateSha256: manifest.candidateSha256,
      expectedProjectId: 'project-production',
      expectedDatabaseId: 'other-production-database',
    })).toThrow(/database/i);
  });

  it('rejects a Functions runtime database that differs from the sealed client target', () => {
    const root = createCandidate('b'.repeat(40));
    fs.writeFileSync(path.join(root, 'functions/lib/runtime-target.json'), JSON.stringify({
      firestoreDatabaseId: 'wrong-functions-database',
    }));

    expect(() => sealReleaseArtifact({
      root,
      revision: 'b'.repeat(40),
      workflowRunId: '56789',
      workflowRunAttempt: '3',
      generatedAt: '2026-08-10T00:00:00.000Z',
    })).toThrow(/Functions.*database/i);
  });

  it('rejects symlinks instead of sealing files outside the candidate', () => {
    const root = createCandidate('c'.repeat(40));
    fs.symlinkSync('/etc/hosts', path.join(root, 'dist/hosts.txt'));

    expect(() => sealReleaseArtifact({
      root,
      revision: 'c'.repeat(40),
      workflowRunId: '90123',
      workflowRunAttempt: '4',
      generatedAt: '2026-08-10T00:00:00.000Z',
    })).toThrow(/symbolic link/);
  });

  it('rejects a symbolic-link ancestor instead of following deployable files outside the candidate', () => {
    const root = createCandidate('d'.repeat(40));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'lingoflash-release-artifact-outside-'));
    temporaryDirectories.push(outside);
    fs.rmSync(path.join(root, 'artifacts'), { recursive: true });
    fs.writeFileSync(path.join(outside, 'phase6-readiness.json'), JSON.stringify({
      revision: 'd'.repeat(40), releaseEligible: true,
    }));
    fs.symlinkSync(outside, path.join(root, 'artifacts'));

    expect(() => sealReleaseArtifact({
      root,
      revision: 'd'.repeat(40),
      workflowRunId: '34567',
      workflowRunAttempt: '5',
      generatedAt: '2026-08-10T00:00:00.000Z',
    })).toThrow(/symbolic link/);
  });

  it.each([
    ['Hosting public directory', { hosting: { public: '..' } }],
    ['Functions source directory', { functions: { source: '../functions' } }],
    ['Firestore Rules path', {
      firestore: [{
        database: 'database-production',
        rules: '../firestore.rules',
        indexes: 'firestore.indexes.json',
      }],
    }],
    ['Firestore indexes path', {
      firestore: [{
        database: 'database-production',
        rules: 'firestore.rules',
        indexes: '../firestore.indexes.json',
      }],
    }],
  ])('rejects a firebase config that redirects the %s outside sealed components', (_label, overrides) => {
    const root = createCandidate('e'.repeat(40));
    fs.writeFileSync(path.join(root, 'firebase.json'), JSON.stringify(firebaseConfig(overrides)));

    expect(() => sealReleaseArtifact({
      root,
      revision: 'e'.repeat(40),
      workflowRunId: '45678',
      workflowRunAttempt: '6',
      generatedAt: '2026-08-10T00:00:00.000Z',
    })).toThrow(/Firebase deployment config/);
  });

  it.each([
    ['KMS-version placeholder', root => writeTrustRoot(root, { keyVersion: 'UNCONFIGURED' })],
    ['algorithm placeholder', root => writeTrustRoot(root, { algorithm: 'UNCONFIGURED' })],
    ['fingerprint placeholder', root => writeTrustRoot(root, { fingerprint: 'UNCONFIGURED' })],
    ['extra field', root => writeTrustRoot(root, { unexpected: true })],
    ['missing file', root => fs.rmSync(path.join(root, 'evidence-attestation-trust-root.json'))],
  ])('rejects a %s trust root before sealing', (_label, changeRoot) => {
    const root = createCandidate('f'.repeat(40));
    changeRoot(root);

    expect(() => sealReleaseArtifact({
      root,
      revision: 'f'.repeat(40),
      workflowRunId: '67890',
      workflowRunAttempt: '7',
      generatedAt: '2026-08-10T00:00:00.000Z',
    })).toThrow(/trust root|UNCONFIGURED/i);
  });

  it('rejects a schema-1 candidate manifest', () => {
    const root = createCandidate('f'.repeat(40));
    const manifest = sealReleaseArtifact({
      root,
      revision: 'f'.repeat(40),
      workflowRunId: '67890',
      workflowRunAttempt: '7',
      generatedAt: '2026-08-10T00:00:00.000Z',
    });

    expect(() => verifyReleaseArtifact({
      root,
      manifest: { ...manifest, schemaVersion: 1 },
      expectedRevision: 'f'.repeat(40),
      expectedWorkflowRunId: '67890',
      expectedWorkflowRunAttempt: '7',
      expectedCandidateSha256: manifest.candidateSha256,
    })).toThrow(/Unsupported release artifact schemaVersion/);
  });

  it('accepts only reviewed KMS metadata and the canonical public-key fingerprint', () => {
    const root = createCandidate('f'.repeat(40));
    const { metadataPath, publicKeyPath } = writeKmsVerificationInputs(root);

    expect(verifyEvidenceAttestationTrustRoot({
      root,
      configuredKmsKeyVersion: TRUSTED_KMS_KEY_VERSION,
      metadataPath,
      publicKeyPath,
    })).toMatchObject({
      evidenceAttestationKmsKeyVersion: TRUSTED_KMS_KEY_VERSION,
      evidenceAttestationKmsAlgorithm: TRUSTED_KMS_ALGORITHM,
    });
  });

  it('rejects an arbitrary valid-looking KMS resource and its matching public key', () => {
    const root = createCandidate('f'.repeat(40));
    const alternateKeyVersion = 'projects/project-production/locations/us-central1/keyRings/release/cryptoKeys/evidence-attestation/cryptoKeyVersions/2';
    const alternateKeyPair = createTestKeyPair();
    const { metadataPath, publicKeyPath } = writeKmsVerificationInputs(root, {
      keyPair: alternateKeyPair,
      name: alternateKeyVersion,
    });

    expect(() => verifyEvidenceAttestationTrustRoot({
      root,
      configuredKmsKeyVersion: alternateKeyVersion,
      metadataPath,
      publicKeyPath,
    })).toThrow(/does not match the reviewed trust root/);
  });

  it('rejects a mismatched KMS metadata name even with the configured reviewed resource', () => {
    const root = createCandidate('f'.repeat(40));
    const { metadataPath, publicKeyPath } = writeKmsVerificationInputs(root, {
      name: 'projects/project-production/locations/us-central1/keyRings/release/cryptoKeys/evidence-attestation/cryptoKeyVersions/2',
    });

    expect(() => verifyEvidenceAttestationTrustRoot({
      root,
      configuredKmsKeyVersion: TRUSTED_KMS_KEY_VERSION,
      metadataPath,
      publicKeyPath,
    })).toThrow(/metadata name/);
  });

  it('rejects a supported but reviewed-root-mismatched KMS algorithm', () => {
    const root = createCandidate('f'.repeat(40));
    const { metadataPath, publicKeyPath } = writeKmsVerificationInputs(root, {
      algorithm: 'EC_SIGN_P256_SHA256',
    });

    expect(() => verifyEvidenceAttestationTrustRoot({
      root,
      configuredKmsKeyVersion: TRUSTED_KMS_KEY_VERSION,
      metadataPath,
      publicKeyPath,
    })).toThrow(/metadata algorithm/);
  });

  it('rejects a different public key when reviewed resource and metadata match', () => {
    const root = createCandidate('f'.repeat(40));
    const { metadataPath, publicKeyPath } = writeKmsVerificationInputs(root, {
      keyPair: createTestKeyPair(),
    });

    expect(() => verifyEvidenceAttestationTrustRoot({
      root,
      configuredKmsKeyVersion: TRUSTED_KMS_KEY_VERSION,
      metadataPath,
      publicKeyPath,
    })).toThrow(/SPKI fingerprint/);
  });

  it('rejects unsupported metadata algorithms and private-key PEM input', () => {
    const root = createCandidate('f'.repeat(40));
    const { metadataPath, publicKeyPath } = writeKmsVerificationInputs(root, {
      algorithm: 'RSA_SIGN_PSS_2048_SHA256',
    });

    expect(() => verifyEvidenceAttestationTrustRoot({
      root,
      configuredKmsKeyVersion: TRUSTED_KMS_KEY_VERSION,
      metadataPath,
      publicKeyPath,
    })).toThrow(/metadata algorithm/);

    writeKmsVerificationInputs(root);
    fs.writeFileSync(publicKeyPath, trustedKeyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }));
    expect(() => verifyEvidenceAttestationTrustRoot({
      root,
      configuredKmsKeyVersion: TRUSTED_KMS_KEY_VERSION,
      metadataPath,
      publicKeyPath,
    })).toThrow(/PEM SubjectPublicKeyInfo/);
  });

  it('uses the public key DER SPKI fingerprint rather than PEM formatting', () => {
    const root = createCandidate('f'.repeat(40));
    const { metadataPath, publicKeyPath } = writeKmsVerificationInputs(root);
    const pem = fs.readFileSync(publicKeyPath, 'utf8').replaceAll('\n', '\r\n');
    fs.writeFileSync(publicKeyPath, pem);

    expect(() => verifyEvidenceAttestationTrustRoot({
      root,
      configuredKmsKeyVersion: TRUSTED_KMS_KEY_VERSION,
      metadataPath,
      publicKeyPath,
    })).not.toThrow();
  });

  it('rejects a trust-root byte change after sealing', () => {
    const root = createCandidate('f'.repeat(40));
    const manifest = sealReleaseArtifact({
      root,
      revision: 'f'.repeat(40),
      workflowRunId: '67890',
      workflowRunAttempt: '7',
      generatedAt: '2026-08-10T00:00:00.000Z',
    });
    writeTrustRoot(root, { fingerprint: 'b'.repeat(64) });

    expect(() => verifyReleaseArtifact({
      root,
      manifest,
      expectedRevision: 'f'.repeat(40),
      expectedWorkflowRunId: '67890',
      expectedWorkflowRunAttempt: '7',
      expectedCandidateSha256: manifest.candidateSha256,
    })).toThrow(/trust root|evidenceAttestationTrustRoot/i);
  });

  it('binds the promoted Firestore config to the protected evidence database', () => {
    expect(() => createPromotedFirebaseConfig(firebaseConfig(), {
      expectedFirestoreDatabaseId: 'other-production-database',
    })).toThrow(/database/);
  });

  it('removes build hooks from a verified config before artifact promotion', () => {
    expect(createPromotedFirebaseConfig(firebaseConfig())).toEqual({
      functions: {
        source: 'functions',
        ignore: ['node_modules', '.git', 'functions.yaml'],
      },
      firestore: [{
        database: 'database-production',
        rules: 'firestore.rules',
        indexes: 'firestore.indexes.json',
      }],
      hosting: { public: 'dist' },
    });
  });

  it('selects only the sealed compatibility Rules artifact for preparatory promotion', () => {
    expect(createPromotedFirebaseConfig(firebaseConfig(), {
      promotedFirestoreRulesPath: 'firestore.compatibility.rules',
    }).firestore[0].rules).toBe('firestore.compatibility.rules');
    expect(() => createPromotedFirebaseConfig(firebaseConfig(), {
      promotedFirestoreRulesPath: '../firestore.compatibility.rules',
    })).toThrow(/sealed compatibility artifact/);
  });
});
