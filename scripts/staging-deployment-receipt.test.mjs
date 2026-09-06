import { describe, expect, it } from 'vitest';
import {
  createStagingDeploymentReceipt,
  verifyStagingDeploymentReceipt,
} from './staging-deployment-receipt.mjs';

const values = {
  repositoryId: '12345',
  repositoryName: 'sonson0910/flash-card',
  deploymentRunId: '67890',
  deploymentRunAttempt: '1',
  sourceRunId: '54321',
  revision: 'a'.repeat(40),
  candidateSha256: 'b'.repeat(64),
  manifestSha256: 'c'.repeat(64),
  readinessSha256: 'd'.repeat(64),
  projectId: 'sonflash-staging-20260906',
  databaseId: 'database-staging',
  origin: 'https://sonflash-staging-20260906.web.app',
  healthSha256: 'e'.repeat(64),
  serviceWorkerSha256: 'f'.repeat(64),
  deployedAt: '2026-09-06T00:00:00.000Z',
};

describe('staging deployment receipt', () => {
  it('binds one deployment to the candidate, protected target and live bytes', () => {
    expect(createStagingDeploymentReceipt(values)).toEqual({
      schemaVersion: 1,
      status: 'verified',
      ...values,
    });
  });

  it('rejects a non-HTTPS staging origin', () => {
    expect(() => createStagingDeploymentReceipt({
      ...values,
      origin: 'http://sonflash-staging-20260906.web.app',
    })).toThrow(/HTTPS/);
  });

  it('rejects an origin that is not owned by the protected project', () => {
    expect(() => createStagingDeploymentReceipt({
      ...values,
      origin: 'https://attacker.example',
    })).toThrow(/project/);
  });

  it('binds production promotion to the exact staging and candidate runs', () => {
    const receipt = createStagingDeploymentReceipt(values);
    expect(() => verifyStagingDeploymentReceipt(receipt, {
      repositoryId: values.repositoryId,
      repositoryName: values.repositoryName,
      deploymentRunId: '99999',
      sourceRunId: values.sourceRunId,
      revision: values.revision,
      candidateSha256: values.candidateSha256,
    })).toThrow(/deploymentRunId/);
  });
});
