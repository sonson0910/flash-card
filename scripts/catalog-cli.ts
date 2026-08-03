import {
  buildCatalogFiles,
  validateCatalogFiles,
  verifyCatalogFiles,
} from './catalog-operator';

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

const run = async (mode: Mode, args: readonly string[]) => {
  if (mode === 'validate') {
    assertExactOptions(args, ['--input']);
    return validateCatalogFiles(option(args, '--input'));
  }
  if (mode === 'build') {
    assertExactOptions(args, ['--input', '--out']);
    return buildCatalogFiles(option(args, '--input'), option(args, '--out'));
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
