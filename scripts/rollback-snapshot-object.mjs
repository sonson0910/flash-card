import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA256 = /^[a-f0-9]{64}$/;
const BUCKET = /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/;
const GENERATION = /^[1-9][0-9]{0,19}$/;
const OBJECT = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$/;
const FIELDS = Object.freeze([
  'schemaVersion', 'provider', 'bucket', 'object', 'generation', 'sizeBytes', 'sha256',
]);
export const MAX_ROLLBACK_SNAPSHOT_CIPHERTEXT_BYTES = 10 * 1024 * 1024 * 1024;

const hasExactFields = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const expected = new Set(FIELDS);
  return Object.keys(value).length === FIELDS.length
    && Object.keys(value).every(field => expected.has(field));
};

const validObjectName = value => typeof value === 'string'
  && OBJECT.test(value)
  && !value.includes('//')
  && !value.split('/').includes('..')
  && !value.endsWith('/');

export function validateRollbackSnapshotObjectDescriptor(descriptor, options = {}) {
  const errors = [];
  if (!hasExactFields(descriptor)) {
    errors.push('Rollback snapshot object descriptor contains unknown fields.');
    if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) return errors;
  }
  if (descriptor.schemaVersion !== 1) errors.push('Rollback snapshot object descriptor schemaVersion must be 1.');
  if (descriptor.provider !== 'gcs') errors.push('Rollback snapshot object descriptor provider must be gcs.');
  if (!BUCKET.test(descriptor.bucket ?? '')) errors.push('Rollback snapshot object descriptor bucket is invalid.');
  if (!validObjectName(descriptor.object)) errors.push('Rollback snapshot object descriptor object name is invalid.');
  if (!GENERATION.test(descriptor.generation ?? '')) errors.push('Rollback snapshot object descriptor generation is invalid.');
  if (!Number.isSafeInteger(descriptor.sizeBytes)
    || descriptor.sizeBytes < 1
    || descriptor.sizeBytes > (options.maxBytes ?? MAX_ROLLBACK_SNAPSHOT_CIPHERTEXT_BYTES)) {
    errors.push('Rollback snapshot object descriptor size is invalid.');
  }
  if (!SHA256.test(descriptor.sha256 ?? '')) errors.push('Rollback snapshot object descriptor SHA-256 is invalid.');
  if (options.expectedBucket && descriptor.bucket !== options.expectedBucket) {
    errors.push('Rollback snapshot object descriptor bucket does not match the protected archive.');
  }
  if (options.expectedPrefix) {
    const expectedPrefix = options.expectedPrefix.endsWith('/')
      ? options.expectedPrefix
      : `${options.expectedPrefix}/`;
    if (!descriptor.object.startsWith(expectedPrefix)) {
      errors.push('Rollback snapshot object descriptor object is outside the protected archive prefix.');
    }
  }
  if (options.expectedSha256 && descriptor.sha256 !== options.expectedSha256) {
    errors.push('Rollback snapshot object descriptor SHA-256 does not match the signed evidence.');
  }
  return [...new Set(errors)];
}

export function readRollbackSnapshotObjectDescriptor(file, options = {}) {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error('Rollback snapshot object descriptor must be a regular file.');
  }
  if (stat.size < 2 || stat.size > 16_384) {
    throw new Error('Rollback snapshot object descriptor size is invalid.');
  }
  const descriptor = JSON.parse(fs.readFileSync(file, 'utf8'));
  const errors = validateRollbackSnapshotObjectDescriptor(descriptor, options);
  if (errors.length > 0) throw new Error(`Rollback snapshot object descriptor is invalid:\n- ${errors.join('\n- ')}`);
  return descriptor;
}

export const rollbackSnapshotObjectUrl = (descriptor, media = false) => {
  const bucket = encodeURIComponent(descriptor.bucket);
  const object = encodeURIComponent(descriptor.object);
  const query = new URLSearchParams({ generation: descriptor.generation });
  if (media) query.set('alt', 'media');
  return `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${object}?${query}`;
};

const sha256File = file => new Promise((resolve, reject) => {
  const hash = createHash('sha256');
  const stream = fs.createReadStream(file);
  stream.on('error', reject);
  stream.on('data', chunk => hash.update(chunk));
  stream.on('end', () => resolve(hash.digest('hex')));
});

const defaultAccessToken = () => execFileSync('gcloud', ['auth', 'print-access-token'], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
}).trim();

export async function downloadRollbackSnapshotObject(descriptor, outputFile, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch;
  const accessToken = (dependencies.accessToken ?? defaultAccessToken()).trim();
  if (!accessToken || /\s/.test(accessToken)) throw new Error('Rollback snapshot archive access token is invalid.');
  if (fs.existsSync(outputFile)) throw new Error('Rollback snapshot output path already exists.');
  const headers = { Authorization: `Bearer ${accessToken}` };
  const metadataResponse = await fetchImpl(rollbackSnapshotObjectUrl(descriptor), {
    headers, redirect: 'error',
  });
  if (!metadataResponse.ok) throw new Error(`Rollback snapshot metadata download failed with HTTP ${metadataResponse.status}.`);
  const metadata = await metadataResponse.json();
  if (metadata.bucket !== descriptor.bucket
    || metadata.name !== descriptor.object
    || metadata.generation !== descriptor.generation
    || metadata.size !== String(descriptor.sizeBytes)) {
    throw new Error('Rollback snapshot object metadata does not match the signed descriptor.');
  }
  const response = await fetchImpl(rollbackSnapshotObjectUrl(descriptor, true), {
    headers, redirect: 'error',
  });
  if (!response.ok || !response.body) {
    throw new Error(`Rollback snapshot download failed with HTTP ${response.status}.`);
  }
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  const temporary = `${outputFile}.partial-${process.pid}`;
  try {
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporary, {
      flags: 'wx', mode: 0o600,
    }));
    const stat = fs.lstatSync(temporary);
    if (!stat.isFile() || stat.size !== descriptor.sizeBytes) {
      throw new Error('Rollback snapshot downloaded size does not match the signed descriptor.');
    }
    if (await sha256File(temporary) !== descriptor.sha256) {
      throw new Error('Rollback snapshot downloaded SHA-256 does not match the signed descriptor.');
    }
    fs.renameSync(temporary, outputFile);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

const parseOptions = args => {
  const options = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith('--') || value === undefined || value.startsWith('--') || options.has(name)) {
      throw new Error('Rollback snapshot options must be unique --name value pairs.');
    }
    options.set(name, value);
  }
  return options;
};

const required = (options, name) => {
  const value = options.get(name);
  if (!value) throw new Error(`Missing required option ${name}.`);
  return value;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] !== 'download') throw new Error('Usage: rollback-snapshot-object.mjs download [--name value]');
  const options = parseOptions(process.argv.slice(3));
  const descriptor = readRollbackSnapshotObjectDescriptor(
    path.resolve(required(options, '--descriptor-file')),
    {
      expectedBucket: required(options, '--expected-bucket'),
      expectedPrefix: required(options, '--expected-prefix'),
      expectedSha256: required(options, '--expected-sha256'),
    },
  );
  await downloadRollbackSnapshotObject(descriptor, path.resolve(required(options, '--output-file')));
  console.log(`Verified rollback snapshot object generation ${descriptor.generation}.`);
}
