import assert from 'node:assert/strict';
import { afterEach, describe, it, vi } from 'vitest';
import { classifyDefaultBucketResponse, readCloudStorageState } from './cloud-storage-state.mjs';

const serviceDisabledFor = service => ({
  error: {
    code: 403,
    status: 'PERMISSION_DENIED',
    message: 'Cloud Storage for Firebase API has not been used in this project before or it is disabled.',
    details: [{
      '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
      reason: 'SERVICE_DISABLED',
      domain: 'googleapis.com',
      metadata: { service, consumer: 'projects/123456789012' },
    }],
  },
});

describe('Cloud Storage state before a Storage Rules deploy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('deploys when the project has a Firebase default bucket', () => {
    assert.deepEqual(classifyDefaultBucketResponse(200, {
      name: 'projects/demo-lingoflash/defaultBucket',
      bucket: { name: 'projects/demo-lingoflash/buckets/demo-lingoflash.firebasestorage.app' },
    }), { state: 'enabled', bucket: 'demo-lingoflash.firebasestorage.app' });
  });

  it('skips a project where Cloud Storage was never set up', () => {
    assert.deepEqual(
      classifyDefaultBucketResponse(404, { error: { code: 404, status: 'NOT_FOUND' } }),
      { state: 'not-enabled' },
    );
  });

  it('skips a project whose Cloud Storage for Firebase API is disabled', () => {
    assert.deepEqual(
      classifyDefaultBucketResponse(403, serviceDisabledFor('firebasestorage.googleapis.com')),
      { state: 'not-enabled' },
    );
  });

  it('fails closed when a disabled service is not Cloud Storage for Firebase', () => {
    assert.throws(() => classifyDefaultBucketResponse(403, serviceDisabledFor('serviceusage.googleapis.com')), /HTTP 403/);
    assert.throws(() => classifyDefaultBucketResponse(403, {
      error: { code: 403, details: [{ reason: 'SERVICE_DISABLED', domain: 'googleapis.com' }] },
    }), /HTTP 403/);
  });

  it('fails closed when the deploy identity is denied or the answer is unexpected', () => {
    assert.throws(() => classifyDefaultBucketResponse(403, {
      error: { code: 403, status: 'PERMISSION_DENIED', details: [] },
    }), /HTTP 403/);
    assert.throws(() => classifyDefaultBucketResponse(500, {}), /HTTP 500/);
    assert.throws(() => classifyDefaultBucketResponse(200, { bucket: {} }), /no default bucket name/);
    assert.throws(() => classifyDefaultBucketResponse(200, null), /no default bucket name/);
  });

  it('bills and checks the lookup against the target project, not the caller identity project', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify(serviceDisabledFor('firebasestorage.googleapis.com')),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    assert.deepEqual(await readCloudStorageState('sonflash-target-1', 'token-value'), { state: 'not-enabled' });
    assert.equal(fetchMock.mock.calls.length, 1);
    const [url, init] = fetchMock.mock.calls[0];
    assert.equal(url, 'https://firebasestorage.googleapis.com/v1alpha/projects/sonflash-target-1/defaultBucket');
    const headers = new Headers(init.headers);
    assert.equal(headers.get('authorization'), 'Bearer token-value');
    assert.equal(headers.get('x-goog-user-project'), 'sonflash-target-1');
  });
});
