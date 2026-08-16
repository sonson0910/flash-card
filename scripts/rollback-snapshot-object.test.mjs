import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  downloadRollbackSnapshotObject,
  readRollbackSnapshotObjectDescriptor,
  rollbackSnapshotObjectUrl,
  validateRollbackSnapshotObjectDescriptor,
} from './rollback-snapshot-object.mjs';

const bytes = Buffer.from('encrypted rollback snapshot');
const descriptor = {
  schemaVersion: 1,
  provider: 'gcs',
  bucket: 'sonflash-rollback-archive',
  object: 'production/reservations/snapshot.enc',
  generation: '1755216000123456',
  sizeBytes: bytes.byteLength,
  sha256: 'a2f8df5f8999b872a426244bb01c486d4b5d8040e13a72e9ace12ae6c832510f',
};

describe('rollback snapshot object descriptor', () => {
  it('accepts an immutable generation under the protected archive prefix', () => {
    expect(validateRollbackSnapshotObjectDescriptor(descriptor, {
      expectedBucket: descriptor.bucket,
      expectedPrefix: 'production/reservations',
      expectedSha256: descriptor.sha256,
    })).toEqual([]);
    expect(validateRollbackSnapshotObjectDescriptor({
      ...descriptor,
      object: 'production/reservations-adjacent/snapshot.enc',
    }, {
      expectedBucket: descriptor.bucket,
      expectedPrefix: 'production/reservations',
      expectedSha256: descriptor.sha256,
    })).toContain('Rollback snapshot object descriptor object is outside the protected archive prefix.');
    expect(rollbackSnapshotObjectUrl(descriptor, true)).toContain(
      'generation=1755216000123456&alt=media',
    );
  });

  it('rejects mutable, out-of-prefix, oversized, or digest-mismatched descriptors', () => {
    expect(validateRollbackSnapshotObjectDescriptor({
      ...descriptor,
      generation: '',
      object: '../snapshot.enc',
      sizeBytes: 10 * 1024 * 1024 * 1024 + 1,
      sha256: 'a'.repeat(64),
      extra: true,
    }, {
      expectedBucket: descriptor.bucket,
      expectedPrefix: 'production/reservations/',
      expectedSha256: descriptor.sha256,
    })).toEqual(expect.arrayContaining([
      expect.stringMatching(/unknown fields/i),
      expect.stringMatching(/object name/i),
      expect.stringMatching(/generation/i),
      expect.stringMatching(/size/i),
      expect.stringMatching(/signed evidence/i),
    ]));
  });

  it('downloads and verifies the exact signed object generation', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sonflash-rollback-object-'));
    const descriptorFile = path.join(directory, 'descriptor.json');
    const outputFile = path.join(directory, 'snapshot.enc');
    fs.writeFileSync(descriptorFile, JSON.stringify(descriptor));
    const requests = [];
    const fetchImpl = async url => {
      requests.push(String(url));
      if (String(url).includes('alt=media')) return new Response(bytes);
      return Response.json({
        bucket: descriptor.bucket,
        name: descriptor.object,
        generation: descriptor.generation,
        size: String(descriptor.sizeBytes),
      });
    };
    try {
      const parsed = readRollbackSnapshotObjectDescriptor(descriptorFile, {
        expectedBucket: descriptor.bucket,
        expectedPrefix: 'production/reservations/',
        expectedSha256: descriptor.sha256,
      });
      await downloadRollbackSnapshotObject(parsed, outputFile, {
        accessToken: 'test-token', fetchImpl,
      });
      expect(fs.readFileSync(outputFile)).toEqual(bytes);
      expect(requests).toHaveLength(2);
      expect(requests.every(url => url.includes(`generation=${descriptor.generation}`))).toBe(true);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects metadata or bytes that differ from the signed descriptor', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sonflash-rollback-object-'));
    const outputFile = path.join(directory, 'snapshot.enc');
    try {
      await expect(downloadRollbackSnapshotObject(descriptor, outputFile, {
        accessToken: 'test-token',
        fetchImpl: async url => String(url).includes('alt=media')
          ? new Response('tampered')
          : Response.json({
            bucket: descriptor.bucket,
            name: descriptor.object,
            generation: descriptor.generation,
            size: String(descriptor.sizeBytes),
          }),
      })).rejects.toThrow(/size does not match/i);
      expect(fs.existsSync(outputFile)).toBe(false);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
