const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const MAX_CHANGED_PATHS = 2_048;
const TEST_FILE = /(?:^|\/)[^/]+(?:\.[^/]+)?\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/;
const CODE_EXTENSION = /\.(?:[cm]?[jt]sx?)$/;
const AUTOMATION_PATH = /^\.claude\/(?:hooks\/|scripts\/|skills\/|settings\.json$)/;
const RELEASE_PATH = /^(?:src\/features\/releaseReadiness\/|scripts\/(?:phase6-|release)|phase-6-release-readiness\.md$|docs\/runbooks\/phase-6-rollout\.md$|deployGateSource\.test\.ts$|evidence-attestation-trust-root\.json$|\.github\/workflows\/(?:release-candidate|reservation-migration|deploy-production)\.yml$)/;
const RULES_PATH = /^(?:firebase\.json$|firestore\.(?:rules|indexes\.json|rules\.test\.ts)$|firestoreRulesSource\.test\.ts$|scripts\/rules-cutover-|functions\/(?:src|test)\/legacyLibraryMigration|\.github\/workflows\/(?:deploy-firestore-rules|repair-legacy-libraries|reservation-migration)\.yml$)/;

function gitOutput(args, cwd) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'buffer',
      timeout: 2_000,
      maxBuffer: 4 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

function nulPaths(buffer) {
  return buffer ? buffer.toString('utf8').split('\0').filter(Boolean) : [];
}

function changedPaths(cwd) {
  const tracked = gitOutput(['diff', '--name-only', '-z', 'HEAD', '--'], cwd);
  const untracked = gitOutput(['ls-files', '--others', '--exclude-standard', '-z', '--'], cwd);
  if (tracked === null || untracked === null) {
    return { files: [], overflow: false, incomplete: true };
  }
  const discovered = [...new Set([...nulPaths(tracked), ...nulPaths(untracked)])]
    .map(file => file.replaceAll(path.sep, '/'))
    .sort();
  return {
    files: discovered.slice(0, MAX_CHANGED_PATHS),
    overflow: discovered.length > MAX_CHANGED_PATHS,
    incomplete: false,
  };
}

function hashFile(hash, absolutePath) {
  const descriptor = fs.openSync(absolutePath, 'r');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead);
  } finally {
    fs.closeSync(descriptor);
  }
}

function diffFingerprint(cwd, files) {
  const head = gitOutput(['rev-parse', 'HEAD'], cwd);
  const rawDiff = gitOutput(['diff', '--raw', '-z', 'HEAD', '--'], cwd);
  if (head === null || rawDiff === null) return null;
  const hash = crypto.createHash('sha256').update(head).update(rawDiff);

  for (const file of files) {
    hash.update('\0').update(file);
    const absolutePath = path.join(cwd, file);
    try {
      const stat = fs.lstatSync(absolutePath);
      hash.update(`:${stat.mode}:${stat.size}:`);
      if (stat.isSymbolicLink()) hash.update(fs.readlinkSync(absolutePath));
      else if (stat.isFile()) hashFile(hash, absolutePath);
    } catch {
      hash.update(':missing:');
    }
  }
  return hash.digest('hex');
}

function matchingTests(cwd, file, functionScope = false) {
  if (TEST_FILE.test(file)) return fs.existsSync(path.join(cwd, file)) ? [file] : [];
  if (!CODE_EXTENSION.test(file)) return [];

  if (functionScope && file.startsWith('functions/src/')) {
    const stem = path.basename(file).replace(CODE_EXTENSION, '');
    const testDir = path.join(cwd, 'functions', 'test');
    try {
      return fs.readdirSync(testDir)
        .filter(name => name.startsWith(stem) && TEST_FILE.test(`functions/test/${name}`))
        .map(name => `functions/test/${name}`)
        .sort();
    } catch {
      return [];
    }
  }

  const directory = path.posix.dirname(file);
  const stem = path.posix.basename(file).replace(CODE_EXTENSION, '');
  try {
    return fs.readdirSync(path.join(cwd, directory))
      .filter(name => name.startsWith(`${stem}.`) && TEST_FILE.test(`${directory}/${name}`))
      .map(name => path.posix.join(directory, name))
      .sort();
  } catch {
    return [];
  }
}

function appCodePath(file) {
  return file.startsWith('src/')
    || file.startsWith('scripts/') && CODE_EXTENSION.test(file)
    || /^(?:[^/]+\.(?:[cm]?[jt]sx?)|package(?:-lock)?\.json|tsconfig[^/]*\.json)$/.test(file);
}

function functionPath(file) {
  return file.startsWith('functions/') && (CODE_EXTENSION.test(file)
    || /(?:^|\/)package(?:-lock)?\.json$/.test(file)
    || /(?:^|\/)tsconfig[^/]*\.json$/.test(file));
}

function check(id, label, command, args, timeoutMs) {
  return { id, label, command, args, timeoutMs };
}

function testFilesInDirectory(cwd, directory) {
  try {
    return fs.readdirSync(path.join(cwd, directory))
      .filter(name => TEST_FILE.test(path.posix.join(directory, name)))
      .map(name => path.posix.join(directory, name))
      .sort();
  } catch {
    return [];
  }
}

function relatedAutomationTests(cwd, file) {
  if (TEST_FILE.test(file)) return fs.existsSync(path.join(cwd, file)) ? [file] : [];

  const directory = path.posix.dirname(file);
  const extension = path.posix.extname(file);
  const stem = path.posix.basename(file, extension);
  if (!extension || !stem) return [];

  return testFilesInDirectory(cwd, directory)
    .filter(testFile => path.posix.basename(testFile).startsWith(`${stem}.`));
}

function automationCheckForTest(testFile) {
  return check(`automation-test:${testFile}`, `Claude automation test: ${testFile}`, 'node', [testFile], 180_000);
}

function skillPackageTest(cwd, file) {
  const match = /^\.claude\/skills\/([^/]+)\//.exec(file);
  if (!match) return null;

  const skillDirectory = `.claude/skills/${match[1]}`;
  try {
    const packageData = JSON.parse(fs.readFileSync(path.join(cwd, skillDirectory, 'package.json'), 'utf8'));
    return typeof packageData.scripts?.test === 'string' ? skillDirectory : null;
  } catch {
    return null;
  }
}

function selectQualityPlan(cwd, files) {
  const checks = [];
  const notes = [];
  const appFiles = files.filter(appCodePath);
  const functionFiles = files.filter(functionPath);
  const e2eFiles = files.filter(file => file.startsWith('e2e/') || file === 'playwright.config.ts');
  const automationChanged = files.some(file => AUTOMATION_PATH.test(file));
  const releaseChanged = files.some(file => RELEASE_PATH.test(file));
  const rulesChanged = files.some(file => RULES_PATH.test(file));

  if (appFiles.length || e2eFiles.length) {
    checks.push(check('app-lint', 'App TypeScript', 'npm', ['run', 'lint'], 120_000));
  }
  const appTests = [...new Set(appFiles.flatMap(file => matchingTests(cwd, file)))];
  if (appTests.length) {
    checks.push(check('app-tests', 'Focused app tests', 'npm', ['run', 'test', '--', '--run', ...appTests], 180_000));
  }
  if (functionFiles.length) {
    checks.push(check('functions-lint', 'Functions TypeScript', 'npm', ['--prefix', 'functions', 'run', 'lint'], 120_000));
    checks.push(check('functions-build', 'Functions build', 'npm', ['--prefix', 'functions', 'run', 'build'], 120_000));
  }
  const functionTests = [...new Set(functionFiles.flatMap(file => matchingTests(cwd, file, true)))];
  if (functionTests.length) {
    const relativeTests = functionTests.map(file => file.replace(/^functions\//, ''));
    checks.push(check('functions-tests', 'Focused Functions tests', 'npm', ['--prefix', 'functions', 'test', '--', ...relativeTests], 180_000));
  }
  if (releaseChanged) {
    checks.push(check('release-tests', 'Release readiness tests', 'npm', ['run', 'test:phase6'], 180_000));
  }
  if (automationChanged) {
    const hookTests = files.some(file => file.startsWith('.claude/hooks/') || file === '.claude/settings.json')
      ? testFilesInDirectory(cwd, '.claude/hooks/__tests__')
      : [];
    if (hookTests.length) {
      checks.push(check('automation-hook-tests', 'Claude hook tests', 'node', ['--test', '--test-concurrency=1', ...hookTests], 120_000));
    }

    const scriptTests = [...new Set(files
      .filter(file => file.startsWith('.claude/scripts/'))
      .flatMap(file => relatedAutomationTests(cwd, file)))]
      .sort();
    for (const testFile of scriptTests) {
      checks.push(automationCheckForTest(testFile));
    }

    const fallbackSkillTests = [];
    for (const file of files.filter(file => file.startsWith('.claude/skills/'))) {
      const skillDirectory = skillPackageTest(cwd, file);
      if (skillDirectory) {
        checks.push(check(
          `automation-skill-test:${skillDirectory}`,
          `Skill package tests: ${skillDirectory}`,
          'npm',
          ['--prefix', skillDirectory, 'test'],
          180_000,
        ));
      } else {
        fallbackSkillTests.push(...relatedAutomationTests(cwd, file));
      }
    }
    for (const testFile of [...new Set(fallbackSkillTests)].sort()) {
      checks.push(automationCheckForTest(testFile));
    }
  }
  if (e2eFiles.length) notes.push('Browser tests were not auto-run; run the relevant Playwright project before shipping.');
  if (rulesChanged) notes.push('RULES_CHECK_REQUIRED');

  const deduped = [...new Map(checks.map(item => [item.id, item])).values()];
  return { checks: deduped, notes, rulesChanged };
}

module.exports = { changedPaths, diffFingerprint, matchingTests, selectQualityPlan };
