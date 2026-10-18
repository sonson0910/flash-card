import fs from 'node:fs';
import path from 'node:path';
import { RELEASE_TARGETS, validateDistTarget } from './release-config.mjs';

const expectedTarget = process.argv[2];
if (!Object.hasOwn(RELEASE_TARGETS, expectedTarget ?? '')) {
  throw new Error('Usage: node scripts/verify-dist-target.mjs <production|staging>');
}
const healthPath = path.resolve('dist/health.json');
if (!fs.existsSync(healthPath)) throw new Error('dist/health.json does not exist. Build the release first.');

const targetConfig = JSON.parse(fs.readFileSync(new URL(`../${RELEASE_TARGETS[expectedTarget].configPath}`, import.meta.url), 'utf8'));
const { projectId } = targetConfig.targets?.[expectedTarget] ?? targetConfig;
const errors = validateDistTarget(JSON.parse(fs.readFileSync(healthPath, 'utf8')), expectedTarget, projectId);
if (errors.length > 0) {
  throw new Error(`Refusing to deploy dist:\n- ${errors.join('\n- ')}`);
}
console.log(`dist is a ${expectedTarget} build for ${projectId}.`);
