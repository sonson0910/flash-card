import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createPromotedFirebaseConfig,
  sealReleaseArtifact,
  verifyReleaseArtifact,
} from './release-artifact.mjs';

const temporaryDirectories = [];

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
  fs.writeFileSync(path.join(root, 'firestore.indexes.json'), '{"indexes":[]}\n');
  fs.writeFileSync(path.join(root, 'firebase.json'), `${JSON.stringify(firebaseConfig())}\n`);
  fs.writeFileSync(path.join(root, 'firebase-applet-config.json'), JSON.stringify({
    projectId: 'project-production',
    firestoreDatabaseId: 'database-production',
  }));
  fs.writeFileSync(path.join(root, 'artifacts/phase6-readiness.json'), JSON.stringify({
    revision, releaseEligible: true,
  }));
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
      generatedAt: '2026-08-10T00:00:00.000Z',
    });

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      revision: 'a'.repeat(40),
      workflowRunId: '12345',
      generatedAt: '2026-08-10T00:00:00.000Z',
      candidateSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(() => verifyReleaseArtifact({
      root,
      manifest,
      expectedRevision: 'a'.repeat(40),
      expectedWorkflowRunId: '12345',
      expectedCandidateSha256: manifest.candidateSha256,
    })).not.toThrow();
  });

  it('rejects a candidate sealed by a different workflow run', () => {
    const root = createCandidate('a'.repeat(40));
    const manifest = sealReleaseArtifact({
      root,
      revision: 'a'.repeat(40),
      workflowRunId: '12345',
      generatedAt: '2026-08-10T00:00:00.000Z',
    });

    expect(() => verifyReleaseArtifact({
      root,
      manifest,
      expectedRevision: 'a'.repeat(40),
      expectedWorkflowRunId: '54321',
      expectedCandidateSha256: manifest.candidateSha256,
    })).toThrow(/workflow run/i);
  });

  it('rejects a modified file after the candidate was sealed', () => {
    const root = createCandidate('b'.repeat(40));
    const manifest = sealReleaseArtifact({
      root,
      revision: 'b'.repeat(40),
      workflowRunId: '56789',
      generatedAt: '2026-08-10T00:00:00.000Z',
    });
    fs.writeFileSync(path.join(root, 'dist/index.html'), '<main>tampered</main>');

    expect(() => verifyReleaseArtifact({
      root,
      manifest,
      expectedRevision: 'b'.repeat(40),
      expectedWorkflowRunId: '56789',
      expectedCandidateSha256: manifest.candidateSha256,
    })).toThrow(/dist/);
  });

  it('rejects a protected deployment target that differs from the sealed client project or database', () => {
    const root = createCandidate('b'.repeat(40));
    const manifest = sealReleaseArtifact({
      root,
      revision: 'b'.repeat(40),
      workflowRunId: '56789',
      generatedAt: '2026-08-10T00:00:00.000Z',
    });

    expect(() => verifyReleaseArtifact({
      root,
      manifest,
      expectedRevision: 'b'.repeat(40),
      expectedWorkflowRunId: '56789',
      expectedCandidateSha256: manifest.candidateSha256,
      expectedProjectId: 'other-production-project',
      expectedDatabaseId: 'database-production',
    })).toThrow(/project/i);
    expect(() => verifyReleaseArtifact({
      root,
      manifest,
      expectedRevision: 'b'.repeat(40),
      expectedWorkflowRunId: '56789',
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
      generatedAt: '2026-08-10T00:00:00.000Z',
    })).toThrow(/Firebase deployment config/);
  });

  it('binds the promoted Firestore config to the protected evidence database', () => {
    expect(() => createPromotedFirebaseConfig(firebaseConfig(), {
      expectedFirestoreDatabaseId: 'other-production-database',
    })).toThrow(/database/);
  });

  it('removes build hooks from a verified config before artifact promotion', () => {
    expect(createPromotedFirebaseConfig(firebaseConfig())).toEqual({
      functions: { source: 'functions' },
      firestore: [{
        database: 'database-production',
        rules: 'firestore.rules',
        indexes: 'firestore.indexes.json',
      }],
      hosting: { public: 'dist' },
    });
  });
});
