import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateStagingReleaseTarget } from './release-artifact.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expected = {
  projectId: 'sonflash-staging-20260906',
  appId: '1:890120640842:web:f8a858029dc582fc7e49b3',
  authDomain: 'sonflash-staging-20260906.firebaseapp.com',
  firestoreDatabaseId: 'ai-studio-945b4052-4462-4668-8936-277f09f07a37',
  region: 'asia-southeast1',
};
const readJson = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const fail = message => { throw new Error(`Staging target is not ready: ${message}`); };

if (process.env.SONFLASH_TARGET && process.env.SONFLASH_TARGET !== 'staging') {
  fail('SONFLASH_TARGET must be staging when preparing a staging build.');
}
if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PROJECT_ID !== expected.projectId) {
  fail('FIREBASE_PROJECT_ID does not match the sealed staging project.');
}
if (process.env.FIRESTORE_DATABASE_ID && process.env.FIRESTORE_DATABASE_ID !== expected.firestoreDatabaseId) {
  fail('FIRESTORE_DATABASE_ID does not match the sealed staging database.');
}

const sealedTarget = validateStagingReleaseTarget(root);
if (sealedTarget.projectId !== expected.projectId || sealedTarget.databaseId !== expected.firestoreDatabaseId) {
  fail('Release artifact validation did not accept the staging target.');
}

const aliases = readJson('.firebaserc').projects;
if (aliases.staging !== expected.projectId) fail('Firebase staging alias does not match the sealed staging project.');

const target = readJson('firebase-targets/staging.json');
for (const [field, value] of Object.entries(expected)) {
  if (target[field] !== value) fail(`firebase-targets/staging.json has an unexpected ${field}.`);
}
if (!target.apiKey || !target.messagingSenderId || !target.appCheckSiteKey) {
  fail('Firebase Web SDK configuration or the App Check site key is missing.');
}

const config = readJson('firebase.json');
const firestoreTargets = Array.isArray(config.firestore) ? config.firestore : [config.firestore];
if (firestoreTargets.length !== 1 || firestoreTargets[0]?.database !== expected.firestoreDatabaseId) {
  fail('firebase.json must bind exactly one Firestore target to the staging database.');
}
if (!config.functions?.source || config.hosting?.public !== 'dist') {
  fail('Firebase Functions and Hosting paths must match the repository release layout.');
}

// Staging deploys use a hook-free derived config so production-only predeploy checks cannot
// rebuild or silently substitute the production client configuration. Always pass --project.
const deployedConfig = structuredClone(config);
const deployedFirestoreTargets = Array.isArray(deployedConfig.firestore)
  ? deployedConfig.firestore
  : [deployedConfig.firestore];
for (const service of [deployedConfig.functions, ...deployedFirestoreTargets, deployedConfig.hosting]) {
  if (service && typeof service === 'object') {
    delete service.predeploy;
    delete service.postdeploy;
  }
}
// Firebase uses the config directory as the project root and rejects sources outside it.
const output = path.join(root, 'firebase.staging.json');
fs.writeFileSync(output, `${JSON.stringify(deployedConfig, null, 2)}\n`, { mode: 0o600 });
const stagingEnv = path.join(root, `functions/.env.${expected.projectId}`);
const requiredStagingEnv = 'ENFORCE_APP_CHECK=true\n';
if (fs.existsSync(stagingEnv)) {
  if (fs.readFileSync(stagingEnv, 'utf8') !== requiredStagingEnv) {
    fail('Functions staging env must contain only ENFORCE_APP_CHECK=true.');
  }
} else {
  fs.writeFileSync(stagingEnv, requiredStagingEnv, { mode: 0o600 });
}
console.log('Verified staging project, app, App Check, and Firestore target; wrote firebase.staging.json.');
console.log(`Deploy target must be passed explicitly as --project ${expected.projectId}.`);
console.log('This command does not deploy or certify a staging smoke.');

export { expected };
