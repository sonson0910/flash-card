import {
  FUNCTION_ID,
  PROJECT_ID,
  REGION,
  REVISION,
  SHA256,
  SITE_ID,
  createProviderReader,
  exactLabelMatch,
  requireAccessToken,
  requirePattern,
} from './provider-readback-http.mjs';

const serviceSnapshot = service => JSON.stringify({
  name: service.name,
  reconciling: service.reconciling,
  terminalState: service.terminalCondition?.state,
  trafficStatuses: [...(service.trafficStatuses ?? [])].map(status => ({
    type: status.type,
    revision: status.revision,
    percent: status.percent,
    tag: status.tag ?? '',
  })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
});

const requireCloudRunService = (service, expectedName) => {
  if (service?.name !== expectedName || service.reconciling !== false
    || service.terminalCondition?.state !== 'CONDITION_SUCCEEDED') {
    throw new Error('Cloud Run serving state is not ready.');
  }
  const statuses = service.trafficStatuses;
  if (!Array.isArray(statuses) || statuses.length === 0 || statuses.length > 20) {
    throw new Error('Cloud Run serving traffic is invalid.');
  }
  let total = 0;
  const revisions = new Set();
  for (const status of statuses) {
    if (!Number.isInteger(status?.percent) || status.percent < 0 || status.percent > 100) {
      throw new Error('Cloud Run serving traffic is invalid.');
    }
    total += status.percent;
    if (status.percent > 0) {
      if (typeof status.revision !== 'string' || status.revision.length === 0) {
        throw new Error('Cloud Run serving traffic lacks a concrete revision.');
      }
      const name = status.revision.includes('/')
        ? status.revision
        : `${expectedName}/revisions/${status.revision}`;
      if (!name.startsWith(`${expectedName}/revisions/`)) {
        throw new Error('Cloud Run serving revision is outside the expected service.');
      }
      revisions.add(name);
    }
  }
  if (total !== 100 || revisions.size === 0) throw new Error('Cloud Run serving traffic is invalid.');
  return [...revisions].sort();
};

export async function verifyRuntimeDeployment({
  accessToken, projectId, hostingSiteId, region, functionIds, revision, candidateSha256,
  fetchImpl = globalThis.fetch,
}) {
  requirePattern(projectId, PROJECT_ID, 'Firebase project ID');
  requirePattern(hostingSiteId, SITE_ID, 'Firebase Hosting site ID');
  requirePattern(region, REGION, 'Functions region');
  requirePattern(revision, REVISION, 'Release revision');
  requirePattern(candidateSha256, SHA256, 'Candidate SHA-256');
  requireAccessToken(accessToken);
  if (!Array.isArray(functionIds) || functionIds.length === 0 || functionIds.length > 50
    || new Set(functionIds).size !== functionIds.length
    || functionIds.some(id => !FUNCTION_ID.test(id))) {
    throw new Error('Expected Functions list is invalid.');
  }

  const get = createProviderReader(accessToken, fetchImpl);
  const hostingBase = 'https://firebasehosting.googleapis.com/v1beta1';
  const siteName = `projects/${projectId}/sites/${hostingSiteId}`;
  const site = await get(`${hostingBase}/${siteName}`, 'Firebase Hosting site');
  if (site?.name !== siteName) throw new Error('Firebase Hosting site does not match the protected target.');

  const channelName = `sites/${hostingSiteId}/channels/live`;
  const firstChannel = await get(`${hostingBase}/${channelName}`, 'Firebase Hosting live channel');
  if (firstChannel?.name !== channelName || typeof firstChannel.release?.name !== 'string') {
    throw new Error('Firebase Hosting live release is unavailable.');
  }
  const release = await get(`${hostingBase}/${firstChannel.release.name}`, 'Firebase Hosting live release');
  const expectedMessage = `sonflash:v1:revision=${revision}:candidate=${candidateSha256}`;
  if (release?.name !== firstChannel.release.name || release.type !== 'DEPLOY'
    || release.message !== expectedMessage || typeof release.version?.name !== 'string') {
    throw new Error('Firebase Hosting live release provenance does not match the candidate.');
  }
  const version = await get(`${hostingBase}/${release.version.name}`, 'Firebase Hosting version');
  if (version?.name !== release.version.name || version.status !== 'FINALIZED') {
    throw new Error('Firebase Hosting live version is not finalized.');
  }
  const health = await get(`https://${hostingSiteId}.web.app/health.json`, 'Firebase Hosting health', false);
  if (health?.status !== 'ok' || health.service !== 'lingoflash' || health.revision !== revision) {
    throw new Error('Firebase Hosting health metadata does not match the candidate.');
  }
  const secondChannel = await get(`${hostingBase}/${channelName}`, 'Firebase Hosting live channel');
  if (secondChannel?.release?.name !== release.name) {
    throw new Error('Firebase Hosting live release changed during verification.');
  }

  const servingRevisions = new Set();
  for (const functionId of [...functionIds].sort()) {
    const functionName = `projects/${projectId}/locations/${region}/functions/${functionId}`;
    const functionResource = await get(
      `https://cloudfunctions.googleapis.com/v2/${functionName}`,
      `Cloud Function ${functionId}`,
    );
    if (functionResource?.name !== functionName || functionResource.state !== 'ACTIVE'
      || functionResource.environment !== 'GEN_2'
      || !exactLabelMatch(functionResource.labels, revision, candidateSha256)) {
      throw new Error(`Cloud Function ${functionId} provenance is not active.`);
    }
    const serviceName = functionResource.serviceConfig?.service;
    if (typeof serviceName !== 'string'
      || !serviceName.startsWith(`projects/${projectId}/locations/${region}/services/`)) {
      throw new Error(`Cloud Function ${functionId} has an invalid Cloud Run service.`);
    }
    const serviceUrl = `https://run.googleapis.com/v2/${serviceName}`;
    const firstService = await get(serviceUrl, `Cloud Run service for ${functionId}`);
    for (const revisionName of requireCloudRunService(firstService, serviceName)) {
      const servingRevision = await get(
        `https://run.googleapis.com/v2/${revisionName}`,
        `Cloud Run revision for ${functionId}`,
      );
      if (servingRevision?.name !== revisionName
        || !exactLabelMatch(servingRevision.labels, revision, candidateSha256)) {
        throw new Error(`Cloud Run revision for ${functionId} has mismatched provenance.`);
      }
      servingRevisions.add(revisionName);
    }
    const secondService = await get(serviceUrl, `Cloud Run service for ${functionId}`);
    if (serviceSnapshot(firstService) !== serviceSnapshot(secondService)) {
      throw new Error(`Cloud Run service for ${functionId} changed during verification.`);
    }
  }
  return {
    status: 'verified',
    mode: 'runtime',
    functionCount: functionIds.length,
    revisionCount: servingRevisions.size,
  };
}
