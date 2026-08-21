import { accessSync, constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIREBASE_VERSION = '15.23.0';
const RULES_COMMAND =
  'vitest run --config vitest.rules.config.ts && npm --prefix functions test -- legacyLibraryMigrationFirestore.integration.test.ts';

export function javaHomeCandidates({ env = process.env, platformName = process.platform } = {}) {
  const candidates = [];

  if (env.JAVA_HOME) candidates.push(env.JAVA_HOME);

  if (platformName === 'darwin') {
    candidates.push(
      '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',
      '/usr/local/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',
      '/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home',
      '/usr/local/opt/openjdk/libexec/openjdk.jdk/Contents/Home',
    );
  }

  if (platformName === 'linux') {
    candidates.push(
      '/usr/lib/jvm/java-21-openjdk-amd64',
      '/usr/lib/jvm/java-21-openjdk',
      '/usr/lib/jvm/jdk-21',
    );
  }

  return [...new Set(candidates)];
}

function isExecutable(filePath) {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function isUsableJavaHome(
  home,
  env,
  platformName,
  executable = isExecutable,
  probe = probeJava,
) {
  const java = join(home, 'bin', platformName === 'win32' ? 'java.exe' : 'java');
  return executable(java) && probe(java, { ...env, JAVA_HOME: home });
}

function probeJava(java, env) {
  const result = spawnSync(java, ['-version'], {
    env,
    encoding: 'utf8',
  });
  if (result.status !== 0) return false;

  const versionOutput = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  return /version\s+"(?:1\.)?21(?:[.+-]|\s|$)/.test(versionOutput);
}

function workingJavaOnPath({ env, platformName, executable, probe }) {
  const commandName = platformName === 'win32' ? 'java.exe' : 'java';
  const entries = env.PATH ? env.PATH.split(delimiter) : [];
  return entries
    .filter(Boolean)
    .map((entry) => join(entry, commandName))
    .find((java) => executable(java) && probe(java, env));
}

export function resolveJavaHome({
  env = process.env,
  platformName = process.platform,
  executable = isExecutable,
  probe = probeJava,
} = {}) {
  const candidates = javaHomeCandidates({ env, platformName });
  return (
    candidates.find((home) => isUsableJavaHome(home, env, platformName, executable, probe)) ?? null
  );
}

export function environmentWithJava(options = {}) {
  const { env = process.env, platformName = process.platform } = options;
  const executable = options.executable ?? isExecutable;
  const probe = options.probe ?? probeJava;
  const javaHome = resolveJavaHome({ ...options, executable, probe });
  if (!javaHome && workingJavaOnPath({ env, platformName, executable, probe })) {
    const environment = { ...env };
    delete environment.JAVA_HOME;
    return environment;
  }

  if (!javaHome) {
    throw new Error(
      'Java 21 is required for Firestore Rules tests. Install a Java 21 runtime or set JAVA_HOME to its JDK home.',
    );
  }

  const bin = join(javaHome, 'bin');
  const pathEntries = env.PATH ? env.PATH.split(delimiter) : [];
  return {
    ...env,
    JAVA_HOME: javaHome,
    PATH: [bin, ...pathEntries.filter((entry) => entry !== bin)].join(delimiter),
  };
}

export function runRulesCommand({
  env,
  npx = process.platform === 'win32' ? 'npx.cmd' : 'npx',
  spawn = spawnSync,
} = {}) {
  const result = spawn(
    npx,
    [
      '--yes',
      `firebase-tools@${FIREBASE_VERSION}`,
      'emulators:exec',
      '--only',
      'firestore',
      '--project',
      'demo-lingoflash',
      RULES_COMMAND,
    ],
    { env, stdio: 'inherit' },
  );

  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = runRulesCommand({ env: environmentWithJava() });
}
