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
const compositePath = argument('--composite');
const databaseMetadataPath = required('--database-metadata');
const operationsPath = required('--operations');
const baselineOperationsPath = required('--baseline-operations');
const target = required('--target');
const revision = required('--revision');
const outputPath = required('--output');
const candidate = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
const active = JSON.parse(fs.readFileSync(activePath, 'utf8'));
const composites = compositePath === undefined ? undefined : JSON.parse(fs.readFileSync(compositePath, 'utf8'));
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
if (composites !== undefined && (!Array.isArray(candidate.indexes) || !Array.isArray(composites))) {
  throw new Error('Composite index readback is malformed.');
}

const indexDigest = crypto.createHash('sha256')
  .update(fs.readFileSync(candidatePath))
  .digest('hex');
const activeField = override => active.find(field => (
  (field.collectionGroup === override.collectionGroup && field.fieldPath === override.fieldPath)
    || (typeof field.name === 'string'
      && field.name.endsWith(`/collectionGroups/${override.collectionGroup}/fields/${override.fieldPath}`))
));
const targetParts = target.split('/');
const targetAncestorField = targetParts.length === 2 && targetParts.every(part => part)
  ? `projects/${targetParts[0]}/databases/${targetParts[1]}/collectionGroups/__default__/fields/*`
  : undefined;
for (const override of candidate.fieldOverrides) {
  if (!override.fieldPath || !Array.isArray(override.indexes)) {
    throw new Error('Candidate index override is malformed.');
  }
  const field = activeField(override);
  if (!field && databaseMetadata.databaseEdition === 'ENTERPRISE' && override.indexes.length === 0) continue;
  if (!field) {
    throw new Error(`Missing active field override ${override.collectionGroup}/${override.fieldPath}`);
  }
  const indexConfig = field.indexConfig;
  const indexes = indexConfig?.indexes;
  const usesAncestorConfig = indexConfig?.usesAncestorConfig;
  const reverting = indexConfig?.reverting;
  const flagsValid = (usesAncestorConfig === undefined || usesAncestorConfig === false)
    && (reverting === undefined || reverting === false);
  const indexesMatch = Array.isArray(indexes)
    ? JSON.stringify(indexes) === JSON.stringify(override.indexes)
    : indexes === undefined && override.indexes.length === 0
      && typeof targetAncestorField === 'string' && indexConfig?.ancestorField === targetAncestorField;
  if (!flagsValid || !indexesMatch) {
    throw new Error(`Field override is not active ${override.collectionGroup}/${override.fieldPath}`);
  }
}
if (composites !== undefined) {
  const targetParts = target.split('/');
  if (targetParts.length !== 2 || targetParts.some(part => !part)) {
    throw new Error('Composite index target is malformed.');
  }
  const targetPrefix = `projects/${targetParts[0]}/databases/${targetParts[1]}/collectionGroups/`;
  const normalizeScope = value => typeof value === 'string' ? value.toUpperCase() : value;
  const normalizeField = field => {
    if (!field || typeof field !== 'object' || typeof field.fieldPath !== 'string') return null;
    const normalized = { fieldPath: field.fieldPath };
    for (const key of ['order', 'arrayConfig']) {
      if (field[key] !== undefined) normalized[key] = normalizeScope(field[key]);
    }
    if (field.vectorConfig !== undefined) normalized.vectorConfig = field.vectorConfig;
    return normalized;
  };
  const sameFields = (expected, actual) => Array.isArray(actual)
    && expected.every(field => normalizeField(field))
    && actual.every(field => normalizeField(field))
    && JSON.stringify(expected.map(normalizeField)) === JSON.stringify(actual.map(normalizeField));
  const activeComposite = (expected) => composites.find(index => {
    if (!index || typeof index !== 'object' || typeof index.name !== 'string') return false;
    if (!index.name.startsWith(targetPrefix)) return false;
    const nameParts = index.name.slice(targetPrefix.length).split('/');
    const collectionGroup = nameParts.length === 3 && nameParts[0] && nameParts[1] === 'indexes'
      ? nameParts[0]
      : undefined;
    return collectionGroup === expected.collectionGroup
      && (index.collectionGroup === undefined || index.collectionGroup === expected.collectionGroup)
      && normalizeScope(index.queryScope) === normalizeScope(expected.queryScope)
      && sameFields(expected.fields, index.fields)
      && index.state === 'READY';
  });
  for (const index of candidate.indexes) {
    if (!index || typeof index !== 'object' || !index.collectionGroup
      || !index.queryScope || !Array.isArray(index.fields)) {
      throw new Error('Candidate composite index is malformed.');
    }
    if (!activeComposite(index)) {
      throw new Error(`Composite index is not READY for ${target}/${index.collectionGroup}.`);
    }
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
if (composites !== undefined) report.compositeCount = candidate.indexes.length;
fs.writeFileSync(outputPath, JSON.stringify(report));
