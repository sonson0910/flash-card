import { createHash } from 'node:crypto';
import fs from 'node:fs';
import {
  DATABASE_ID,
  PROJECT_ID,
  createProviderReader,
  requireAccessToken,
  requirePattern,
} from './provider-readback-http.mjs';

const MAX_RULES_BYTES = 256 * 1024;

export async function verifyFirestoreRulesDeployment({
  accessToken,
  projectId,
  databaseId,
  rulesFile,
  fetchImpl = globalThis.fetch,
}) {
  requirePattern(projectId, PROJECT_ID, 'Firebase project ID');
  requirePattern(databaseId, DATABASE_ID, 'Firestore database ID');
  requireAccessToken(accessToken);

  let rulesBytes;
  try {
    const stat = fs.lstatSync(rulesFile);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_RULES_BYTES) {
      throw new Error('invalid rules file');
    }
    rulesBytes = fs.readFileSync(rulesFile);
    if (rulesBytes.byteLength > MAX_RULES_BYTES) throw new Error('invalid rules file');
  } catch {
    throw new Error('Expected Firestore Rules file is invalid.');
  }

  const expectedDigest = createHash('sha256').update(rulesBytes).digest('hex');
  const get = createProviderReader(accessToken, fetchImpl);
  const releaseName = `projects/${projectId}/releases/cloud.firestore/${databaseId}`;
  const releaseUrl = `https://firebaserules.googleapis.com/v1/${releaseName}`;
  const firstRelease = await get(releaseUrl, 'Firestore Rules release');
  if (firstRelease?.name !== releaseName
    || typeof firstRelease.rulesetName !== 'string'
    || !firstRelease.rulesetName.startsWith(`projects/${projectId}/rulesets/`)) {
    throw new Error('Firestore Rules release does not match the protected target.');
  }

  const ruleset = await get(
    `https://firebaserules.googleapis.com/v1/${firstRelease.rulesetName}`,
    'Firestore Rules ruleset',
  );
  const files = ruleset?.source?.files;
  if (ruleset?.name !== firstRelease.rulesetName || !Array.isArray(files) || files.length !== 1
    || typeof files[0]?.content !== 'string'
    || createHash('sha256').update(files[0].content, 'utf8').digest('hex') !== expectedDigest) {
    throw new Error('Active Firestore Rules source does not match the sealed candidate.');
  }

  const secondRelease = await get(releaseUrl, 'Firestore Rules release');
  if (secondRelease?.name !== firstRelease.name || secondRelease.rulesetName !== firstRelease.rulesetName) {
    throw new Error('Firestore Rules release changed during verification.');
  }
  return { status: 'verified', mode: 'rules', rulesSha256: expectedDigest };
}
