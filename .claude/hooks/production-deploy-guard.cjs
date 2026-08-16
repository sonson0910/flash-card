#!/usr/bin/env node
/**
 * Blocks unsupported local Firebase deployment and asks before protected
 * production workflow dispatches. Inspection, emulators, and verification pass.
 */

const fs = require('node:fs');
const { classifyCommand } = require('./lib/production-command-classifier.cjs');

function readPayload() {
  const input = fs.readFileSync(0, 'utf8').trim();
  return input ? JSON.parse(input) : {};
}

function emit(decision) {
  const deny = decision.decision === 'deny';
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision.decision,
      permissionDecisionReason: decision.reason || (deny
        ? 'Local Firebase deployment is unsupported. Production deployment is workflow-only and evidence-gated.'
        : `Dispatching ${decision.target} is an outward-facing production action and requires explicit approval.`),
    },
  }));
}

function main() {
  const payload = readPayload();
  if (payload.tool_name !== 'Bash') return;
  const decision = classifyCommand(String(payload.tool_input?.command || ''));
  if (decision) emit(decision);
}

try {
  if (require.main === module) main();
} catch {
  process.exit(0);
}
