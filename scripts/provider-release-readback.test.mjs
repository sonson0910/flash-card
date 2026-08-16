import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  verifyFirestoreRulesDeployment,
  verifyRuntimeDeployment,
} from './provider-release-readback.mjs';

const projectId = 'project-production';
const hostingSiteId = 'project-production';
const region = 'asia-southeast1';
const revision = 'a'.repeat(40);
const candidateSha256 = 'b'.repeat(64);
const accessToken = 'test-access-token-with-sufficient-length';
const functionIds = ['createSharedDeck', 'generateVocabulary'];
const temporaryDirectories = [];

const labels = (overrides = {}) => ({
  'sonflash-provenance': 'v1',
  'sonflash-revision-1': revision.slice(0, 32),
  'sonflash-revision-2': revision.slice(32),
  'sonflash-candidate-1': candidateSha256.slice(0, 32),
  'sonflash-candidate-2': candidateSha256.slice(32),
  ...overrides,
});

const jsonResponse = (value, init = {}) => new Response(JSON.stringify(value), {
  status: 200,
  headers: { 'content-type': 'application/json', ...init.headers },
  ...init,
});

const runtimeFixture = () => {
  const routes = new Map();
  const siteName = `projects/${projectId}/sites/${hostingSiteId}`;
  const channelName = `sites/${hostingSiteId}/channels/live`;
  const releaseName = `sites/${hostingSiteId}/releases/release-1`;
  const versionName = `sites/${hostingSiteId}/versions/version-1`;
  routes.set(`https://firebasehosting.googleapis.com/v1beta1/${siteName}`, { name: siteName });
  routes.set(`https://firebasehosting.googleapis.com/v1beta1/${channelName}`, {
    name: channelName,
    release: { name: releaseName },
  });
  routes.set(`https://firebasehosting.googleapis.com/v1beta1/${releaseName}`, {
    name: releaseName,
    type: 'DEPLOY',
    message: `sonflash:v1:revision=${revision}:candidate=${candidateSha256}`,
    version: { name: versionName },
  });
  routes.set(`https://firebasehosting.googleapis.com/v1beta1/${versionName}`, {
    name: versionName,
    status: 'FINALIZED',
  });
  routes.set(`https://${hostingSiteId}.web.app/health.json`, {
    status: 'ok',
    service: 'lingoflash',
    revision,
  });
  for (const functionId of functionIds) {
    const functionName = `projects/${projectId}/locations/${region}/functions/${functionId}`;
    const serviceName = `projects/${projectId}/locations/${region}/services/${functionId.toLowerCase()}`;
    const revisionName = `${serviceName}/revisions/${functionId.toLowerCase()}-00001`;
    routes.set(`https://cloudfunctions.googleapis.com/v2/${functionName}`, {
      name: functionName,
      state: 'ACTIVE',
      environment: 'GEN_2',
      labels: labels(),
      serviceConfig: { service: serviceName },
    });
    routes.set(`https://run.googleapis.com/v2/${serviceName}`, {
      name: serviceName,
      reconciling: false,
      terminalCondition: { state: 'CONDITION_SUCCEEDED' },
      trafficStatuses: [{
        type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION',
        revision: revisionName,
        percent: 100,
      }],
    });
    routes.set(`https://run.googleapis.com/v2/${revisionName}`, {
      name: revisionName,
      labels: labels(),
    });
  }
  return routes;
};

const createFetch = (routes, calls = []) => async (input, init) => {
  const url = String(input);
  calls.push({ url, init });
  if (!routes.has(url)) return jsonResponse({ error: 'not found' }, { status: 404 });
  const route = routes.get(url);
  const value = Array.isArray(route) ? route.shift() : route;
  return value instanceof Response ? value : jsonResponse(value);
};

const verifyRuntime = (fetchImpl, overrides = {}) => verifyRuntimeDeployment({
  accessToken,
  projectId,
  hostingSiteId,
  region,
  functionIds,
  revision,
  candidateSha256,
  fetchImpl,
  ...overrides,
});

const createRulesFile = content => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sonflash-provider-readback-'));
  temporaryDirectories.push(directory);
  const file = path.join(directory, 'firestore.rules');
  fs.writeFileSync(file, content);
  return file;
};

const rulesFixture = content => {
  const releaseName = `projects/${projectId}/releases/cloud.firestore/database-production`;
  const rulesetName = `projects/${projectId}/rulesets/ruleset-1`;
  return new Map([
    [`https://firebaserules.googleapis.com/v1/${releaseName}`, {
      name: releaseName,
      rulesetName,
    }],
    [`https://firebaserules.googleapis.com/v1/${rulesetName}`, {
      name: rulesetName,
      source: { files: [{ name: 'firestore.rules', content }] },
    }],
  ]);
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('provider release read-back', () => {
  it('verifies live Hosting and every concrete serving Functions revision with GET-only requests', async () => {
    const calls = [];
    const result = await verifyRuntime(createFetch(runtimeFixture(), calls));

    expect(result).toEqual({
      status: 'verified',
      mode: 'runtime',
      functionCount: 2,
      revisionCount: 2,
    });
    expect(calls.every(call => call.init.method === 'GET' && call.init.body === undefined)).toBe(true);
    const healthCall = calls.find(call => call.url.endsWith('/health.json'));
    expect(healthCall.init.headers).toBeUndefined();
    expect(calls.filter(call => !call.url.endsWith('/health.json'))
      .every(call => call.init.headers.Authorization === `Bearer ${accessToken}`)).toBe(true);
    expect(calls.filter(call => call.url.includes('/channels/live'))).toHaveLength(2);
    expect(calls.filter(call => call.url.includes('run.googleapis.com/v2/')
      && !call.url.includes('/revisions/'))).toHaveLength(4);
  });

  it('fails closed when a serving Cloud Run revision has another candidate label', async () => {
    const routes = runtimeFixture();
    const revisionRoute = [...routes.keys()].find(url => url.includes('/revisions/'));
    routes.set(revisionRoute, {
      name: revisionRoute.replace('https://run.googleapis.com/v2/', ''),
      labels: labels({ 'sonflash-candidate-2': 'c'.repeat(32) }),
    });

    await expect(verifyRuntime(createFetch(routes))).rejects.toThrow(
      'has mismatched provenance',
    );
  });

  it('fails closed when observed Cloud Run traffic changes during verification', async () => {
    const routes = runtimeFixture();
    const serviceRoute = [...routes.keys()].find(url => (
      url.includes('run.googleapis.com/v2/') && !url.includes('/revisions/')
    ));
    const first = routes.get(serviceRoute);
    routes.set(serviceRoute, [first, {
      ...first,
      trafficStatuses: [{ ...first.trafficStatuses[0], percent: 99 }],
    }]);

    await expect(verifyRuntime(createFetch(routes))).rejects.toThrow(
      'changed during verification',
    );
  });

  it('rejects malformed immutable inputs before any provider request', async () => {
    let called = false;
    await expect(verifyRuntime(async () => {
      called = true;
      return jsonResponse({});
    }, { revision: 'A'.repeat(40) })).rejects.toThrow('Release revision is invalid');
    expect(called).toBe(false);
  });

  it('bounds provider responses even when no Content-Length is available', async () => {
    const routes = runtimeFixture();
    const siteRoute = `https://firebasehosting.googleapis.com/v1beta1/projects/${projectId}/sites/${hostingSiteId}`;
    routes.set(siteRoute, new Response(`{"padding":"${'x'.repeat(512 * 1024)}"}`, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await expect(verifyRuntime(createFetch(routes))).rejects.toThrow('exceeded the response limit');
  });

  it('sanitizes provider transport failures while reading a response body', async () => {
    const routes = runtimeFixture();
    const siteRoute = `https://firebasehosting.googleapis.com/v1beta1/projects/${projectId}/sites/${hostingSiteId}`;
    routes.set(siteRoute, new Response(new ReadableStream({
      start(controller) {
        controller.error(new Error('sensitive provider transport detail'));
      },
    }), { status: 200 }));

    await expect(verifyRuntime(createFetch(routes))).rejects.toThrow(
      'Firebase Hosting site could not be read.',
    );
  });

  it('verifies the active named-database Rules source and double-reads its release', async () => {
    const content = 'rules_version = "2";\nservice cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read: if false; } } }\n';
    const rulesFile = createRulesFile(content);
    const calls = [];
    const result = await verifyFirestoreRulesDeployment({
      accessToken,
      projectId,
      databaseId: 'database-production',
      rulesFile,
      fetchImpl: createFetch(rulesFixture(content), calls),
    });

    expect(result).toMatchObject({
      status: 'verified',
      mode: 'rules',
      rulesSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(calls).toHaveLength(3);
    expect(calls[0].url).toBe(calls[2].url);
    expect(calls.every(call => call.init.method === 'GET' && call.init.body === undefined)).toBe(true);
  });

  it('rejects active Rules source bytes that differ from the sealed candidate', async () => {
    const rulesFile = createRulesFile('rules_version = "2";\n');
    await expect(verifyFirestoreRulesDeployment({
      accessToken,
      projectId,
      databaseId: 'database-production',
      rulesFile,
      fetchImpl: createFetch(rulesFixture('rules_version = "1";\n')),
    })).rejects.toThrow('does not match the sealed candidate');
  });

  it('fails closed when the active Rules release changes during verification', async () => {
    const content = 'rules_version = "2";\n';
    const rulesFile = createRulesFile(content);
    const routes = rulesFixture(content);
    const releaseRoute = [...routes.keys()].find(url => url.includes('/releases/'));
    const first = routes.get(releaseRoute);
    routes.set(releaseRoute, [first, { ...first, rulesetName: `${first.rulesetName}-new` }]);

    await expect(verifyFirestoreRulesDeployment({
      accessToken,
      projectId,
      databaseId: 'database-production',
      rulesFile,
      fetchImpl: createFetch(routes),
    })).rejects.toThrow('changed during verification');
  });
});
