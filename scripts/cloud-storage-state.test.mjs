import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { classifyDefaultBucketResponse } from './cloud-storage-state.mjs';

const serviceDisabled = {
  error: {
    code: 403,
    status: 'PERMISSION_DENIED',
    message: 'Cloud Storage for Firebase API has not been used in this project before or it is disabled.',
    details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'SERVICE_DISABLED', domain: 'googleapis.com' }],
  },
};

describe('Cloud Storage state before a Storage Rules deploy', () => {
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
    assert.deepEqual(classifyDefaultBucketResponse(403, serviceDisabled), { state: 'not-enabled' });
  });

  it('fails closed when the deploy identity is denied or the answer is unexpected', () => {
    assert.throws(() => classifyDefaultBucketResponse(403, {
      error: { code: 403, status: 'PERMISSION_DENIED', details: [] },
    }), /HTTP 403/);
    assert.throws(() => classifyDefaultBucketResponse(500, {}), /HTTP 500/);
    assert.throws(() => classifyDefaultBucketResponse(200, { bucket: {} }), /no default bucket name/);
    assert.throws(() => classifyDefaultBucketResponse(200, null), /no default bucket name/);
  });
});
