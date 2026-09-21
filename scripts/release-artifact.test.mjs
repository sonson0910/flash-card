import fs from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { afterEach as nodeAfterEach, describe as nodeDescribe, it as nodeIt } from 'node:test';
import os from 'node:os';
import path from 'node:path';
import {
  createPromotedFirebaseConfig,
  sealReleaseArtifact,
  verifyReleaseArtifact,
} from './release-artifact.mjs';

const nodeExpect = actual => ({
  toBe: expected => assert.equal(actual, expected),
  toEqual: expected => assert.deepEqual(actual, expected),
  toMatch: expected => assert.match(actual, expected),
  toMatchObject: expected => assert.partialDeepStrictEqual(actual, expected),
  toThrow: expected => assert.throws(actual, expected),
  not: {
    toBe: expected => assert.notEqual(actual, expected),
  },
});
const nodeItWithEach = Object.assign(nodeIt, {
  each: cases => (name, callback) => cases.forEach(args => (
    nodeIt(name.replace('%s', args[0]), () => callback(...args))
  )),
});

const { afterEach, describe, expect, it } = process.env.VITEST
  ? await import('vitest')
  : { afterEach: nodeAfterEach, describe: nodeDescribe, expect: nodeExpect, it: nodeItWithEach };

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
    fs.writeFileSync(path.join(root, 'package.json'), '{"devDependencies":{"firebase-tools":"15.29.0"}}\n');
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{"lockfileVersion":3}\n');
  fs.writeFileSync(path.join(root, 'firestore.rules'), 'rules_version = "2";');
  fs.writeFileSync(path.join(root, 'firestore.indexes.json'), '{"indexes":[]}\n');
  fs.writeFileSync(path.join(root, 'firebase.json'), `${JSON.stringify(firebaseConfig())}\n`);
  fs.writeFileSync(path.join(root, 'firebase-applet-config.json'), JSON.stringify({
    targets: {
      production: {
        allowedHosts: ['project-production.web.app'],
        appCheckSiteKey: '6Lc_production-app-check-site-key',
        projectId: 'project-production',
        firestoreDatabaseId: 'database-production',
      },
      staging: {
        allowedHosts: ['project-staging.web.app'],
        appCheckSiteKey: '6Lc_staging-app-check-site-key',
        projectId: 'project-staging',
        firestoreDatabaseId: 'database-production',
      },
    },
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
  it('refuses an unrelated 200 server on the configured E2E port instead of hopping ports', async () => {
    const staleServer = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"status":"ok","service":"unrelated"}');
    });
    await new Promise((resolve, reject) => {
      staleServer.once('error', reject);
      staleServer.listen(4173, '127.0.0.1', resolve);
    });
    try {
      const config = fs.readFileSync(path.resolve('playwright.config.ts'), 'utf8');
      assert.match(config, /--port 4173 --strictPort/);
      assert.match(config, /reuseExistingServer: false/);
      let failure;
      try {
        execFileSync('npm', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], {
          encoding: 'utf8',
          stdio: 'pipe',
          timeout: 10_000,
        });
      } catch (error) {
        failure = error;
      }
      assert.ok(failure, 'strict preview must reject the occupied E2E port');
      assert.match(`${failure.stderr}`, /Port 4173 is already in use/);
    } finally {
      await new Promise((resolve, reject) => staleServer.close(error => error ? reject(error) : resolve()));
    }
  });

  it('distinguishes local builds by their deterministic output content, not revision', () => {
    const first = fs.mkdtempSync(path.join(os.tmpdir(), 'lingoflash-build-metadata-'));
    const second = fs.mkdtempSync(path.join(os.tmpdir(), 'lingoflash-build-metadata-'));
    temporaryDirectories.push(first, second);
    for (const [root, contents] of [[first, 'first'], [second, 'second']]) {
      fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
      fs.writeFileSync(path.join(root, 'dist/index.html'), '<main>release</main>');
      fs.writeFileSync(path.join(root, 'dist/app.js'), contents);
      execFileSync(process.execPath, [path.resolve('scripts/generate-build-metadata.mjs')], {
        cwd: root,
        env: { ...process.env, BUILD_TIMESTAMP: '2026-09-21T00:00:00.000Z' },
      });
    }
    const firstHealth = JSON.parse(fs.readFileSync(path.join(first, 'dist/health.json'), 'utf8'));
    const secondHealth = JSON.parse(fs.readFileSync(path.join(second, 'dist/health.json'), 'utf8'));

    expect(firstHealth.revision).toBe('local');
    expect(secondHealth.revision).toBe('local');
    expect(firstHealth.artifactId).toMatch(/^[a-f0-9]{64}$/);
    expect(secondHealth.artifactId).toMatch(/^[a-f0-9]{64}$/);
    expect(firstHealth.artifactId).not.toBe(secondHealth.artifactId);
  });

  it('seals the root package manifest and lockfile with the deployable candidate', () => {
    const root = createCandidate('a'.repeat(40));
    const manifest = sealReleaseArtifact({
      root,
      revision: 'a'.repeat(40),
      workflowRunId: '12345',
      generatedAt: '2026-08-10T00:00:00.000Z',
    });

    expect(manifest.components.rootPackage).toMatchObject({ path: 'package.json' });
    expect(manifest.components.rootLock).toMatchObject({ path: 'package-lock.json' });
    fs.writeFileSync(path.join(root, 'package.json'), '{"tampered":true}\n');
    expect(() => verifyReleaseArtifact({
      root,
      manifest,
      expectedRevision: 'a'.repeat(40),
      expectedWorkflowRunId: '12345',
      expectedCandidateSha256: manifest.candidateSha256,
    })).toThrow(/rootPackage/);
  });

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
    });
    expect(manifest.candidateSha256).toMatch(/^[a-f0-9]{64}$/);
    verifyReleaseArtifact({
      root,
      manifest,
      expectedRevision: 'a'.repeat(40),
      expectedWorkflowRunId: '12345',
      expectedCandidateSha256: manifest.candidateSha256,
    });
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
