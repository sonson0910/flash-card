import crypto from 'node:crypto';
import fs from 'node:fs';

const argument = name => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const required = name => {
  const value = argument(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const candidatePath = required('--indexes');
const activePath = required('--active');
const databaseMetadataPath = required('--database-metadata');
const operationsPath = required('--operations');
const baselineOperationsPath = required('--baseline-operations');
const target = required('--target');
const revision = required('--revision');
const outputPath = required('--output');
const candidate = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
const active = JSON.parse(fs.readFileSync(activePath, 'utf8'));
const databaseMetadata = JSON.parse(fs.readFileSync(databaseMetadataPath, 'utf8'));
const operations = JSON.parse(fs.readFileSync(operationsPath, 'utf8'));
const baselineOperations = JSON.parse(fs.readFileSync(baselineOperationsPath, 'utf8'));

if (!Array.isArray(candidate.fieldOverrides)) throw new Error('Candidate index overrides are malformed.');
if (!['STANDARD', 'ENTERPRISE'].includes(databaseMetadata?.databaseEdition)) {
  throw new Error('Firestore database metadata is malformed.');
}
if (!Array.isArray(active) || !Array.isArray(operations) || !Array.isArray(baselineOperations)) {
  throw new Error('Active index readback is malformed.');
}

const indexDigest = crypto.createHash('sha256')
  .update(fs.readFileSync(candidatePath))
  .digest('hex');
const activeField = override => active.find(field => (
  (field.collectionGroup === override.collectionGroup && field.fieldPath === override.fieldPath)
    || (typeof field.name === 'string'
      && field.name.endsWith(`/collectionGroups/${override.collectionGroup}/fields/${override.fieldPath}`))
));
for (const override of candidate.fieldOverrides) {
  if (!override.fieldPath || !Array.isArray(override.indexes)) {
    throw new Error('Candidate index override is malformed.');
  }
  const field = activeField(override);
  if (!field && databaseMetadata.databaseEdition === 'ENTERPRISE' && override.indexes.length === 0) continue;
  if (!field) {
    throw new Error(`Missing active field override ${override.collectionGroup}/${override.fieldPath}`);
  }
  const indexes = field.indexConfig?.indexes ?? field.indexes;
  if (!Array.isArray(indexes) || JSON.stringify(indexes) !== JSON.stringify(override.indexes)
    || field.indexConfig?.reverting === true || field.reverting === true) {
    throw new Error(`Field override is not active ${override.collectionGroup}/${override.fieldPath}`);
  }
}
const baselineNames = new Set(baselineOperations.map(operation => operation?.name).filter(Boolean));
const candidateOperations = operations.filter(operation => !baselineNames.has(operation?.name));
for (const operation of candidateOperations) {
  if (operation.done !== true || operation.error) throw new Error('Firestore index operation is incomplete or failed.');
}
if (!/^[a-f0-9]{64}$/.test(indexDigest)) throw new Error('Index digest is malformed.');
const report = {
  active: true,
  completedAt: new Date().toISOString(),
  indexDigest,
  operationIds: candidateOperations
    .map(operation => operation.name)
    .filter(name => typeof name === 'string')
    .sort(),
  revision,
  schemaVersion: 1,
  target,
};
fs.writeFileSync(outputPath, JSON.stringify(report));
