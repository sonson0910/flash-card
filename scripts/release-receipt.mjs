import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const POSITIVE_INTEGER = /^[1-9][0-9]{0,19}$/;
const REVISION = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ARTIFACT_DIGEST = /^sha256:[a-f0-9]{64}$/;
const REPOSITORY_NAME = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

const required = (value, pattern, label) => {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error(`Release verification receipt ${label} is invalid.`);
  }
  return value;
};

const timestamp = (value, label) => {
  const verified = required(value, ISO_UTC, label);
  const normalized = new Date(verified);
  if (!Number.isFinite(normalized.getTime())) {
    throw new Error(`Release verification receipt ${label} is invalid.`);
  }
  const iso = normalized.toISOString();
  if (iso !== verified && iso.replace('.000Z', 'Z') !== verified) {
    throw new Error(`Release verification receipt ${label} is invalid.`);
  }
  return iso;
};

export function createReleaseVerificationReceipt(values) {
  return {
    schemaVersion: 1,
    repositoryId: required(values?.repositoryId, POSITIVE_INTEGER, 'repositoryId'),
    repositoryName: required(values?.repositoryName, REPOSITORY_NAME, 'repositoryName'),
    verificationRunId: required(values?.verificationRunId, POSITIVE_INTEGER, 'verificationRunId'),
    verificationRunAttempt: required(values?.verificationRunAttempt, POSITIVE_INTEGER, 'verificationRunAttempt'),
    sourceRunId: required(values?.sourceRunId, POSITIVE_INTEGER, 'sourceRunId'),
    artifactId: required(values?.artifactId, POSITIVE_INTEGER, 'artifactId'),
    artifactDigest: required(values?.artifactDigest, ARTIFACT_DIGEST, 'artifactDigest'),
    artifactExpiresAt: timestamp(values?.artifactExpiresAt, 'artifactExpiresAt'),
    revision: required(values?.revision, REVISION, 'revision'),
    candidateSha256: required(values?.candidateSha256, SHA256, 'candidateSha256'),
    manifestSha256: required(values?.manifestSha256, SHA256, 'manifestSha256'),
    readinessSha256: required(values?.readinessSha256, SHA256, 'readinessSha256'),
    verifiedAt: timestamp(values?.verifiedAt, 'verifiedAt'),
    status: 'verified',
  };
}

export function writeReleaseVerificationReceipt(output, values) {
  const receipt = createReleaseVerificationReceipt(values);
  const file = path.resolve(output);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(receipt)}\n`, { encoding: 'utf8', mode: 0o600 });
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const output = process.argv[2] || 'artifacts/release-verification-receipt.json';
  writeReleaseVerificationReceipt(output, {
    repositoryId: process.env.RELEASE_RECEIPT_REPOSITORY_ID,
    repositoryName: process.env.RELEASE_RECEIPT_REPOSITORY_NAME,
    verificationRunId: process.env.RELEASE_RECEIPT_VERIFICATION_RUN_ID,
    verificationRunAttempt: process.env.RELEASE_RECEIPT_VERIFICATION_RUN_ATTEMPT,
    sourceRunId: process.env.RELEASE_RECEIPT_SOURCE_RUN_ID,
    artifactId: process.env.RELEASE_RECEIPT_ARTIFACT_ID,
    artifactDigest: process.env.RELEASE_RECEIPT_ARTIFACT_DIGEST,
    artifactExpiresAt: process.env.RELEASE_RECEIPT_ARTIFACT_EXPIRES_AT,
    revision: process.env.RELEASE_RECEIPT_REVISION,
    candidateSha256: process.env.RELEASE_RECEIPT_CANDIDATE_SHA256,
    manifestSha256: process.env.RELEASE_RECEIPT_MANIFEST_SHA256,
    readinessSha256: process.env.RELEASE_RECEIPT_READINESS_SHA256,
    verifiedAt: process.env.RELEASE_RECEIPT_VERIFIED_AT || new Date().toISOString(),
  });
}
