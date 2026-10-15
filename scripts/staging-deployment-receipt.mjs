import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const INTEGER = /^[1-9][0-9]{0,19}$/;
const REVISION = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const SHA256 = /^[a-f0-9]{64}$/;
const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const DATABASE_ID = /^(?:\(default\)|[a-z][a-z0-9-]{2,61}[a-z0-9])$/;

const requirePattern = (value, pattern, label) => {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error(`Staging deployment receipt ${label} is invalid.`);
  }
  return value;
};

export function createStagingDeploymentReceipt(values) {
  const projectId = requirePattern(values.projectId, PROJECT_ID, 'projectId');
  const origin = new URL(values.origin);
  if (
    origin.protocol !== 'https:'
    || origin.pathname !== '/'
    || origin.search !== ''
    || origin.hash !== ''
  ) throw new Error('Staging deployment receipt requires an HTTPS origin.');
  if (![`${projectId}.web.app`, `${projectId}.firebaseapp.com`].includes(origin.hostname)) {
    throw new Error('Staging deployment receipt origin does not match its protected project.');
  }
  const deployedAt = new Date(values.deployedAt);
  if (!Number.isFinite(deployedAt.getTime()) || deployedAt.toISOString() !== values.deployedAt) {
    throw new Error('Staging deployment receipt deployedAt is invalid.');
  }
  return {
    schemaVersion: 1,
    status: 'verified',
    repositoryId: requirePattern(values.repositoryId, INTEGER, 'repositoryId'),
    repositoryName: requirePattern(values.repositoryName, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'repositoryName'),
    deploymentRunId: requirePattern(values.deploymentRunId, INTEGER, 'deploymentRunId'),
    deploymentRunAttempt: requirePattern(values.deploymentRunAttempt, INTEGER, 'deploymentRunAttempt'),
    sourceRunId: requirePattern(values.sourceRunId, INTEGER, 'sourceRunId'),
    revision: requirePattern(values.revision, REVISION, 'revision'),
    candidateSha256: requirePattern(values.candidateSha256, SHA256, 'candidateSha256'),
    manifestSha256: requirePattern(values.manifestSha256, SHA256, 'manifestSha256'),
    readinessSha256: requirePattern(values.readinessSha256, SHA256, 'readinessSha256'),
    projectId,
    databaseId: requirePattern(values.databaseId, DATABASE_ID, 'databaseId'),
    origin: origin.origin,
    healthSha256: requirePattern(values.healthSha256, SHA256, 'healthSha256'),
    serviceWorkerSha256: requirePattern(values.serviceWorkerSha256, SHA256, 'serviceWorkerSha256'),
    deployedAt: values.deployedAt,
  };
}

export function writeStagingDeploymentReceipt(file, values) {
  const receipt = createStagingDeploymentReceipt(values);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(receipt)}\n`, { encoding: 'utf8', mode: 0o600 });
  return receipt;
}

export function verifyStagingDeploymentReceipt(receipt, expected) {
  const normalized = createStagingDeploymentReceipt(receipt);
  if (JSON.stringify(receipt) !== JSON.stringify(normalized)) {
    throw new Error('Staging deployment receipt schema is invalid.');
  }
  for (const [field, value] of Object.entries(expected)) {
    if (receipt[field] !== value) {
      throw new Error(`Staging deployment receipt ${field} does not match the protected release gate.`);
    }
  }
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === 'verify') {
    const receipt = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
    verifyStagingDeploymentReceipt(receipt, {
      repositoryId: process.env.GITHUB_REPOSITORY_ID,
      repositoryName: process.env.GITHUB_REPOSITORY,
      deploymentRunId: process.env.STAGING_RUN_ID,
      sourceRunId: process.env.CANDIDATE_RUN_ID,
      revision: process.env.REVISION,
      candidateSha256: process.env.CANDIDATE_SHA256,
    });
    console.log(`Verified staging deployment receipt from run ${receipt.deploymentRunId}.`);
  } else writeStagingDeploymentReceipt(process.argv[2] || 'artifacts/staging-deployment-receipt.json', {
    repositoryId: process.env.GITHUB_REPOSITORY_ID,
    repositoryName: process.env.GITHUB_REPOSITORY,
    deploymentRunId: process.env.GITHUB_RUN_ID,
    deploymentRunAttempt: process.env.GITHUB_RUN_ATTEMPT,
    sourceRunId: process.env.CANDIDATE_RUN_ID,
    revision: process.env.REVISION,
    candidateSha256: process.env.CANDIDATE_SHA256,
    manifestSha256: process.env.MANIFEST_SHA256,
    readinessSha256: process.env.READINESS_SHA256,
    projectId: process.env.FIREBASE_PROJECT_ID,
    databaseId: process.env.FIRESTORE_DATABASE_ID,
    origin: process.env.STAGING_ORIGIN,
    healthSha256: process.env.HEALTH_SHA256,
    serviceWorkerSha256: process.env.SERVICE_WORKER_SHA256,
    deployedAt: process.env.DEPLOYED_AT,
  });
}
