const path = require('node:path');
const { nestedCommands, shellSegments, shellWords } = require('./shell-command-parser.cjs');

const MAX_COMMAND_LENGTH = 100_000;
const MAX_RECURSION_DEPTH = 4;
const PROTECTED_WORKFLOW_FILES = new Set([
  'release-candidate.yml',
  'repair-legacy-libraries.yml',
  'reservation-migration.yml',
  'deploy-production.yml',
  'deploy-firestore-rules.yml',
]);
const PROTECTED_WORKFLOW_NAMES = new Set([
  'build release candidate',
  'repair production legacy libraries',
  'execute and attest reservation migration',
  'deploy production artifact',
  'deploy production firestore rules cutover',
]);
const FIREBASE_VALUE_FLAGS = new Set(['-P', '--project', '--account', '--config', '--token']);
const GH_GLOBAL_VALUE_FLAGS = new Set(['-R', '--repo', '--hostname']);
const GH_RUN_VALUE_FLAGS = new Set(['-F', '--field', '-f', '--raw-field', '-r', '--ref']);
const GH_WORKFLOW_VALUE_FLAGS = new Set([...GH_GLOBAL_VALUE_FLAGS, ...GH_RUN_VALUE_FLAGS]);
const GH_API_VALUE_FLAGS = new Set([...GH_GLOBAL_VALUE_FLAGS, '-H', '--header', '-F', '--field', '-f', '--raw-field', '-X', '--method', '--input', '--jq', '--template']);
const DLX_VALUE_FLAGS = new Set(['-p', '--package']);
const NPM_GLOBAL_VALUE_FLAGS = new Set([
  '-C', '--prefix', '-w', '--workspace', '--cache', '--globalconfig', '--userconfig',
  '--registry', '--scope', '--loglevel', '--location', '--omit', '--include',
  '--install-strategy', '--auth-type', '--otp', '--before', '--tag', '--access',
]);
const NODE_VALUE_FLAGS = new Set(['-r', '--require', '--import', '--loader', '--experimental-loader', '--conditions', '--env-file', '--env-file-if-exists', '--openssl-config', '--icu-data-dir']);
const WRAPPER_VALUE_FLAGS = {
  exec: new Set(['-a']),
  nice: new Set(['-n', '--adjustment']),
  sudo: new Set(['-C', '--close-from', '-D', '--chdir', '-g', '--group', '-h', '--host', '-p', '--prompt', '-R', '--chroot', '-T', '--command-timeout', '-t', '--type', '-u', '--user']),
  timeout: new Set(['-k', '--kill-after', '-s', '--signal']),
  xargs: new Set(['-a', '--arg-file', '-d', '--delimiter', '-E', '--eof', '-I', '--replace', '-L', '--max-lines', '-n', '--max-args', '-P', '--max-procs', '-s', '--max-chars', '--process-slot-var']),
};

function skipOptions(words, valueFlags = new Set()) {
  let index = 0;
  while (index < words.length) {
    const word = words[index];
    if (word === '--') return words.slice(index + 1);
    if (!word.startsWith('-') || word === '-') break;
    const flag = word.split('=', 1)[0];
    index += 1;
    if (word === flag && valueFlags.has(flag)) index += 1;
  }
  return words.slice(index);
}

function unwrapExecutable(words) {
  let command = words;
  for (let depth = 0; depth < 6 && command.length; depth += 1) {
    const executable = path.basename(command[0]);
    if (executable === 'env') {
      command = skipOptions(command.slice(1));
      while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(command[0] || '')) command = command.slice(1);
      continue;
    }
    if (executable === 'command') {
      if (command.slice(1).some(word => word === '-v' || word === '-V')) return command;
      command = skipOptions(command.slice(1));
      continue;
    }
    if (executable === 'timeout') {
      const tail = skipOptions(command.slice(1), WRAPPER_VALUE_FLAGS.timeout);
      command = tail.slice(1);
      continue;
    }
    if (executable === 'xargs') {
      command = skipOptions(command.slice(1), WRAPPER_VALUE_FLAGS.xargs);
      continue;
    }
    if (['exec', 'nice', 'sudo'].includes(executable)) {
      command = skipOptions(command.slice(1), WRAPPER_VALUE_FLAGS[executable]);
      while (executable === 'sudo' && /^[A-Za-z_][A-Za-z0-9_]*=/.test(command[0] || '')) command = command.slice(1);
      continue;
    }
    if (executable === 'nohup') {
      command = skipOptions(command.slice(1));
      continue;
    }
    break;
  }
  return command;
}

function executableWords(words) {
  let index = 0;
  while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index] || '')) index += 1;
  return unwrapExecutable(words.slice(index));
}

function isFirebasePackage(token) {
  return /^(?:firebase|firebase-tools)(?:@[^/\s]+)?$/.test(path.basename(token || ''));
}

function firebaseSubcommand(words) {
  return skipOptions(words, FIREBASE_VALUE_FLAGS)[0] || null;
}

function isFirebaseCliScript(token) {
  const parts = String(token || '').replaceAll('\\', '/').split('/').filter(Boolean);
  for (let index = 0; index <= parts.length - 5; index += 1) {
    if (parts[index] === 'node_modules'
      && /^firebase-tools(?:@[^/]+)?$/.test(parts[index + 1])
      && parts.slice(index + 2).join('/') === 'lib/bin/firebase.js') return true;
  }
  return false;
}

function npmExecArguments(command) {
  const invocation = skipOptions(command.slice(1), NPM_GLOBAL_VALUE_FLAGS);
  return invocation[0] === 'exec' ? invocation.slice(1) : null;
}

function packageRunnerInvocation(command, executable) {
  if (executable === 'npx') return skipOptions(command.slice(1), new Set([...DLX_VALUE_FLAGS, '-c', '--call']));
  if (executable === 'npm') {
    const execArguments = npmExecArguments(command);
    return execArguments
      ? skipOptions(execArguments, new Set([...DLX_VALUE_FLAGS, '-c', '--call', '-w', '--workspace']))
      : null;
  }
  if (['pnpm', 'yarn'].includes(executable) && command[1] === 'dlx') return skipOptions(command.slice(2), DLX_VALUE_FLAGS);
  if (executable === 'bunx') return skipOptions(command.slice(1), DLX_VALUE_FLAGS);
  return null;
}

function isFirebaseDeploy(words) {
  const command = executableWords(words);
  const executable = path.basename(command[0] || '');
  if (isFirebasePackage(executable)) return firebaseSubcommand(command.slice(1)) === 'deploy';
  if (['node', 'nodejs'].includes(executable)) {
    const invocation = skipOptions(command.slice(1), NODE_VALUE_FLAGS);
    return isFirebaseCliScript(invocation[0]) && firebaseSubcommand(invocation.slice(1)) === 'deploy';
  }
  const invocation = packageRunnerInvocation(command, executable);
  return Boolean(invocation && isFirebasePackage(invocation[0]) && firebaseSubcommand(invocation.slice(1)) === 'deploy');
}

function packageCallCommand(words) {
  const command = executableWords(words);
  const executable = path.basename(command[0] || '');
  const invocation = executable === 'npx'
    ? command.slice(1)
    : executable === 'npm'
      ? npmExecArguments(command)
      : null;
  if (!invocation) return null;
  for (let index = 0; index < invocation.length; index += 1) {
    const [flag, inline] = invocation[index].split('=', 2);
    if (flag === '-c' || flag === '--call') return inline || invocation[index + 1] || null;
  }
  return null;
}

function dispatchWorkflowTarget(endpoint) {
  const pathWithoutQuery = String(endpoint || '').split(/[?#]/, 1)[0].replace(/\/+$/, '');
  const match = /(?:^|\/)actions\/workflows\/([^/]+)\/dispatches$/.exec(pathWithoutQuery);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function isProtectedWorkflowTarget(target) {
  return Boolean(target && (
    PROTECTED_WORKFLOW_FILES.has(target)
    || PROTECTED_WORKFLOW_NAMES.has(target.toLowerCase())
    || /^\d+$/.test(target)
  ));
}

function protectedWorkflowName(words) {
  const command = executableWords(words);
  if (path.basename(command[0] || '') !== 'gh') return null;
  const invocation = skipOptions(command.slice(1), GH_GLOBAL_VALUE_FLAGS);
  if (invocation[0] === 'workflow') {
    const workflowInvocation = skipOptions(invocation.slice(1), GH_GLOBAL_VALUE_FLAGS);
    if (workflowInvocation[0] !== 'run') return null;
    const target = path.basename(skipOptions(workflowInvocation.slice(1), GH_WORKFLOW_VALUE_FLAGS)[0] || '');
    if (!target) return 'unclassifiable/protected workflow dispatch';
    return isProtectedWorkflowTarget(target) ? target : null;
  }
  if (invocation[0] === 'api') {
    const target = dispatchWorkflowTarget(skipOptions(invocation.slice(1), GH_API_VALUE_FLAGS)[0]);
    return isProtectedWorkflowTarget(target) ? target : null;
  }
  return null;
}

function classifyCommand(command, depth = 0) {
  if (!command) return null;
  if (command.length > MAX_COMMAND_LENGTH || depth > MAX_RECURSION_DEPTH) {
    return {
      decision: 'ask',
      target: 'unclassifiable shell execution',
      reason: 'Shell execution exceeds the production guard safety bounds and requires explicit approval.',
    };
  }
  for (const nested of nestedCommands(command)) {
    const decision = classifyCommand(nested, depth + 1);
    if (decision) return decision;
  }
  for (const segment of shellSegments(command)) {
    const words = shellWords(segment);
    const packageCall = packageCallCommand(words);
    if (packageCall) {
      const decision = classifyCommand(packageCall, depth + 1);
      if (decision) return decision;
    }
    if (isFirebaseDeploy(words)) return { decision: 'deny', target: 'firebase deploy' };
    const workflow = protectedWorkflowName(words);
    if (workflow) return { decision: 'ask', target: workflow };

    const executable = executableWords(words);
    if (['bash', 'sh', 'zsh'].includes(path.basename(executable[0] || ''))) {
      const commandIndex = executable.findIndex(word => word === '-c' || word === '-lc');
      if (commandIndex >= 0 && executable[commandIndex + 1]) {
        const decision = classifyCommand(executable[commandIndex + 1], depth + 1);
        if (decision) return decision;
      }
    }
  }
  return null;
}

module.exports = { classifyCommand, shellSegments, shellWords };
