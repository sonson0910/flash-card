import {
  buildCatalogFiles,
  validateCatalogFiles,
  verifyCatalogFiles,
} from './catalog-operator';
import type { CatalogReviewerAuthorityV1 } from '../src/features/catalogPipeline/catalogContracts';

type Mode = 'validate' | 'build' | 'verify';

const option = (args: readonly string[], name: string): string => {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1] || args[index + 1].startsWith('--')) {
    throw new TypeError(`Missing required ${name} option.`);
  }
  return args[index + 1];
};

const assertExactOptions = (args: readonly string[], expected: readonly string[]): void => {
  const allowed = new Set(expected);
  for (let index = 0; index < args.length; index += 2) {
    if (!allowed.has(args[index]) || !args[index + 1]) throw new TypeError(`Unknown catalog option ${args[index] ?? ''}.`);
  }
};

const protectedReviewerAuthority = (): CatalogReviewerAuthorityV1 => {
  const reviewerId = process.env.CATALOG_REVIEWER_ID;
  const approvedDigest = process.env.CATALOG_APPROVED_DIGEST;
  const reviewedAt = process.env.CATALOG_REVIEWED_AT;
  if (!reviewerId || !approvedDigest || !reviewedAt) {
    throw new TypeError(
      'CATALOG_REVIEWER_ID, CATALOG_APPROVED_DIGEST, and CATALOG_REVIEWED_AT are required for catalog builds.',
    );
  }
  if (
    reviewerId !== reviewerId.trim()
    || !/^[A-Za-z0-9](?:[A-Za-z0-9._:@/-]{0,127})?$/.test(reviewerId)
  ) throw new TypeError('CATALOG_REVIEWER_ID contains an invalid reviewer identity.');
  if (!/^[a-f0-9]{64}$/.test(approvedDigest)) {
    throw new TypeError('CATALOG_APPROVED_DIGEST must be an exact lowercase SHA-256 digest.');
  }
  const timestamp = Date.parse(reviewedAt);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== reviewedAt) {
    throw new TypeError('CATALOG_REVIEWED_AT must be an exact canonical ISO-8601 UTC timestamp.');
  }
  return { reviewerId, approvedDigest, reviewedAt };
};

const run = async (mode: Mode, args: readonly string[]) => {
  if (mode === 'validate') {
    assertExactOptions(args, ['--input']);
    return validateCatalogFiles(option(args, '--input'));
  }
  if (mode === 'build') {
    assertExactOptions(args, ['--input', '--out']);
    return buildCatalogFiles(
      option(args, '--input'), option(args, '--out'), protectedReviewerAuthority(),
    );
  }
  assertExactOptions(args, ['--manifest']);
  return verifyCatalogFiles(option(args, '--manifest'));
};

const [mode, ...args] = process.argv.slice(2);
if (!['validate', 'build', 'verify'].includes(mode)) {
  console.error(JSON.stringify({ status: 'error', message: 'Expected validate, build, or verify.' }));
  process.exitCode = 2;
} else {
  try {
    const report = await run(mode as Mode, args);
    console.log(JSON.stringify(report));
    if (report.status === 'rejected') process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
    }));
    process.exitCode = 1;
  }
}
