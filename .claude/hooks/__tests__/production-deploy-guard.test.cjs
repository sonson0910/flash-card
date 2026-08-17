const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { describe, it } = require('node:test');
const path = require('node:path');

const HOOK = path.resolve(__dirname, '..', 'production-deploy-guard.cjs');
const CLASSIFIER = path.resolve(__dirname, '..', 'lib', 'production-command-classifier.cjs');
const { classifyCommand } = require(CLASSIFIER);

function runHook(command, toolName = 'Bash') {
  return spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: toolName,
      tool_input: { command },
    }),
    encoding: 'utf8',
  });
}

function outputFor(command) {
  const result = runHook(command);
  assert.equal(result.status, 0);
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
}

describe('production deploy guard classification', () => {
  it('denies direct Firebase deployments', () => {
    for (const command of [
      'firebase deploy',
      'firebase --project production deploy --only hosting',
      'firebase-tools deploy --only functions',
      'npx firebase-tools deploy',
      'npx --yes firebase-tools@15.23.0 deploy --only firestore:rules',
      'npm exec firebase-tools -- deploy --only hosting',
      'npm --prefix . exec firebase-tools -- deploy --only hosting',
      'npm --prefix . --silent --loglevel warn exec firebase-tools -- deploy --only hosting',
      'npm exec --package firebase-tools -- firebase deploy --only hosting',
      'pnpm dlx firebase-tools@15.23.0 deploy --only firestore:rules',
      'yarn dlx firebase-tools@15.23.0 deploy --only functions',
      'bunx firebase-tools@15.23.0 deploy --only hosting',
      'node node_modules/firebase-tools/lib/bin/firebase.js deploy --only hosting',
      'node --no-warnings ./node_modules/firebase-tools@15.23.0/lib/bin/firebase.js deploy',
      'node node_modules/.pnpm/firebase-tools@15.23.0/node_modules/firebase-tools/lib/bin/firebase.js deploy',
      'API_KEY=x firebase deploy',
      'env CI=1 npx -y firebase-tools@15.23.0 deploy',
    ]) {
      assert.deepEqual(classifyCommand(command)?.decision, 'deny', command);
    }
  });

  it('denies deployments in shell wrappers, pipelines, and substitutions', () => {
    for (const command of [
      "bash -c 'firebase deploy --only hosting'",
      'printf ready && npx firebase-tools deploy',
      'echo ready | firebase deploy',
      'echo "$(firebase deploy --only functions)"',
      'echo `firebase deploy --only hosting`',
      'sudo firebase deploy --only hosting',
      'command firebase deploy --only hosting',
      'exec firebase deploy --only hosting',
      'timeout 30 firebase deploy --only hosting',
      'nohup firebase deploy --only hosting',
      'xargs -I{} firebase deploy --only hosting',
      'cat <(firebase deploy --only hosting)',
      "npm exec -c 'firebase deploy --only hosting'",
      "npm --prefix . --loglevel warn exec -c 'firebase deploy --only hosting'",
      "npx --call 'firebase deploy --only hosting'",
    ]) {
      assert.deepEqual(classifyCommand(command)?.decision, 'deny', command);
    }
  });

  it('allows emulators, inspection, and verification', () => {
    for (const command of [
      'firebase emulators:start',
      'firebase emulators:exec --only firestore "npm test"',
      'firebase projects:list',
      'firebase use',
      'firebase help deploy',
      'firebase --project production help deploy',
      'command -v firebase',
      'npm run verify:deploy',
      'npm run test:rules',
      'gh workflow view deploy-production.yml',
      'gh run view 1234',
    ]) {
      assert.equal(classifyCommand(command), null, command);
    }
  });

  it('treats deployment text used as data as safe', () => {
    for (const command of [
      'echo "firebase deploy"',
      'printf "%s" "npx firebase-tools deploy"',
      'grep -R "firebase deploy" README.md',
      'rg "deploy-production.yml" .github/workflows',
      'node -e "console.log(\'firebase deploy\')"',
      'node node_modules/firebase-tools/lib/bin/firebase.js --help',
      'node node_modules/not-firebase-tools/lib/bin/firebase.js deploy',
      'echo "node node_modules/firebase-tools/lib/bin/firebase.js deploy"',
      "echo '$(firebase deploy)'",
      "echo '`firebase deploy`'",
      'echo "<(firebase deploy --only hosting)"',
      'printf "%s" ">(firebase deploy --only hosting)"',
    ]) {
      assert.equal(classifyCommand(command), null, command);
    }
  });

  it('asks before protected or numeric workflow dispatches', () => {
    for (const command of [
      'gh workflow run release-candidate.yml -f revision=abc',
      'gh workflow run repair-legacy-libraries.yml -f revision=abc',
      'gh workflow run reservation-migration.yml -f mode=apply',
      'gh workflow run .github/workflows/deploy-production.yml -f revision=abc',
      'gh workflow run deploy-firestore-rules.yml',
      'gh api --method POST repos/o/r/actions/workflows/reservation-migration.yml/dispatches',
      'gh api --method POST repos/o/r/actions/workflows/deploy-production.yml/dispatches',
      'gh --repo sonson0910/flash-card workflow run deploy-production.yml',
      'gh -R sonson0910/flash-card workflow run --ref main release-candidate.yml',
      'gh --hostname github.com api --method POST repos/o/r/actions/workflows/deploy-firestore-rules.yml/dispatches',
      'gh workflow run -R sonson0910/flash-card deploy-production.yml',
      'gh workflow run --hostname github.com deploy-firestore-rules.yml',
      'gh workflow --repo sonson0910/flash-card run deploy-production.yml',
      'gh workflow -R sonson0910/flash-card run "dEpLoY production ARTIFACT"',
      'gh workflow --hostname github.com run 12345',
      'gh workflow run 12345',
      'gh workflow run --ref main 12345',
      'gh api --method POST repos/o/r/actions/workflows/12345/dispatches',
      'gh api --method POST https://api.github.com/repos/o/r/actions/workflows/12345/dispatches',
    ]) {
      assert.deepEqual(classifyCommand(command)?.decision, 'ask', command);
    }
  });

  it('asks before targetless workflow dispatches', () => {
    for (const command of [
      'gh workflow run',
      'gh -R sonson0910/flash-card workflow run',
      'gh workflow -R sonson0910/flash-card run',
      'gh workflow run --ref main',
    ]) {
      const decision = classifyCommand(command);
      assert.equal(decision?.decision, 'ask', command);
      assert.equal(decision?.target, 'unclassifiable/protected workflow dispatch', command);
    }
  });

  it('asks before protected workflow display-name dispatches', () => {
    for (const command of [
      'gh workflow run "Build release candidate" -f revision=abc',
      'gh workflow run "BUILD RELEASE CANDIDATE" -f revision=abc',
      "gh workflow run 'Repair production legacy libraries' -f revision=abc",
      "gh workflow run 'Repair Production Legacy Libraries' -f revision=abc",
      'gh workflow run Execute\\ and\\ attest\\ reservation\\ migration -f mode=apply',
      'gh workflow run "execute and attest reservation migration" -f mode=apply',
      'gh -R sonson0910/flash-card workflow run "Deploy production artifact" -f revision=abc',
      'gh -R sonson0910/flash-card workflow run "deploy PRODUCTION artifact" -f revision=abc',
      "gh workflow run --ref main 'Deploy production Firestore Rules cutover'",
      "gh workflow run --ref main 'DEPLOY production Firestore RULES cutover'",
    ]) {
      assert.deepEqual(classifyCommand(command)?.decision, 'ask', command);
    }
  });

  it('allows explicitly unrelated named workflow dispatches', () => {
    for (const command of [
      'gh workflow run quality.yml',
      'gh workflow --repo sonson0910/flash-card run quality.yml',
      'gh workflow run "Quality gates"',
      'gh api --method POST repos/o/r/actions/workflows/quality.yml/dispatches',
      'gh api --method POST repos/o/r/issues -f note=actions/workflows/12345/dispatches',
    ]) {
      assert.equal(classifyCommand(command), null, command);
    }
  });

  it('requires approval when parser safety bounds are exceeded', () => {
    assert.equal(classifyCommand('x'.repeat(100_001))?.decision, 'ask');
  });
});

describe('production deploy guard hook output', () => {
  it('emits a deny decision for local deployment', () => {
    const output = outputFor('firebase deploy --only hosting');
    assert.equal(output.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.equal(output.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(output.hookSpecificOutput.permissionDecisionReason, /workflow-only/);
  });

  it('emits deny decisions for package-runner and direct-Node deployments', () => {
    for (const command of [
      'pnpm dlx firebase-tools deploy --only hosting',
      'npm --prefix . exec firebase-tools -- deploy --only hosting',
      'node node_modules/firebase-tools/lib/bin/firebase.js deploy --only functions',
    ]) {
      const output = outputFor(command);
      assert.equal(output.hookSpecificOutput.permissionDecision, 'deny', command);
      assert.match(output.hookSpecificOutput.permissionDecisionReason, /workflow-only/, command);
    }
  });

  it('emits an ask decision for protected filename and display-name dispatches', () => {
    for (const command of [
      'gh workflow run deploy-production.yml',
      'gh workflow run "dEpLoY production ARTIFACT"',
    ]) {
      const output = outputFor(command);
      assert.equal(output.hookSpecificOutput.permissionDecision, 'ask', command);
      assert.match(output.hookSpecificOutput.permissionDecisionReason, /explicit approval/, command);
    }
  });

  it('emits an ask decision for targetless workflow dispatches', () => {
    for (const command of [
      'gh workflow run',
      'gh -R sonson0910/flash-card workflow run',
      'gh workflow -R sonson0910/flash-card run',
      'gh workflow run --ref main',
    ]) {
      const output = outputFor(command);
      assert.equal(output.hookSpecificOutput.permissionDecision, 'ask', command);
      assert.match(output.hookSpecificOutput.permissionDecisionReason, /explicit approval/, command);
    }
  });

  it('emits an ask decision for numeric workflow dispatch IDs', () => {
    for (const command of [
      'gh workflow run 12345',
      'gh api --method POST repos/o/r/actions/workflows/12345/dispatches',
    ]) {
      const output = outputFor(command);
      assert.equal(output.hookSpecificOutput.permissionDecision, 'ask', command);
      assert.match(output.hookSpecificOutput.permissionDecisionReason, /explicit approval/, command);
    }
  });

  it('is silent for allowed and non-Bash payloads', () => {
    for (const command of [
      'firebase projects:list',
      'gh workflow run quality.yml',
      'gh workflow view deploy-production.yml',
    ]) {
      assert.equal(outputFor(command), null, command);
    }
    const result = runHook('firebase deploy', 'Read');
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
  });

  it('fails open for malformed input', () => {
    const result = spawnSync(process.execPath, [HOOK], {
      input: '{bad json',
      encoding: 'utf8',
    });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
  });
});
