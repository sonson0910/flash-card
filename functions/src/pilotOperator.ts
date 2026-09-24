import { userInfo } from 'node:os';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { grantPro, readProStatus, revokePro } from './entitlements.js';
import { loadPilotConfig } from './pilotConfig.js';
import { validatePilotTarget } from './pilotTarget.js';
import { emitAnalyticsBestEffort } from './analyticsEvents.js';
import { isAccountDeleting, resumeAccountDeletion } from './accountData.js';
import { getAuth } from 'firebase-admin/auth';

type OperatorMode = 'grant' | 'revoke' | 'status' | 'resume-deletion';

export function validatePilotOperatorRequest(environment: NodeJS.ProcessEnv) {
  const target = validatePilotTarget(environment);
  const mode = environment.PILOT_OPERATOR_MODE?.trim();
  const uid = environment.PILOT_OPERATOR_UID?.trim() ?? '';
  const pid = environment.PILOT_OPERATOR_PID?.trim() ?? '';
  const reason = environment.PILOT_OPERATOR_REASON?.trim() ?? '';
  const pidKey = environment.ANALYTICS_PSEUDONYM_KEY ?? '';
  if (mode !== 'grant' && mode !== 'revoke' && mode !== 'status' && mode !== 'resume-deletion') {
    throw new Error('PILOT_OPERATOR_MODE must be grant, revoke, status or resume-deletion.');
  }
  if (mode === 'resume-deletion') {
    if (!/^[a-f0-9]{32}$/.test(pid)) throw new Error('PILOT_OPERATOR_PID must be one deletion pid.');
  } else if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new Error('PILOT_OPERATOR_UID must be one valid Auth UID.');
  if (environment.PILOT_OPERATOR_CONFIRMATION !== `${mode}:${target.target}`) {
    throw new Error('PILOT_OPERATOR_CONFIRMATION must equal mode:target.');
  }
  if (mode !== 'status' && mode !== 'resume-deletion' && (!reason || reason.length > 280 || pidKey.length < 32)) {
    throw new Error('Mutations require a bounded PILOT_OPERATOR_REASON and ANALYTICS_PSEUDONYM_KEY.');
  }
  return { ...target, mode: mode as OperatorMode, uid, pid, reason, pidKey };
}

if (require.main === module) {
  const input = validatePilotOperatorRequest(process.env);
  const app = getApps()[0] ?? initializeApp({ projectId: input.projectId });
  const database = getFirestore(app, input.databaseId);
  const run = async () => {
    if (input.mode === 'resume-deletion') {
      return { status: await resumeAccountDeletion(database, getAuth(app), input.pid) };
    }
    const config = await loadPilotConfig(database);
    if (input.mode === 'status') return readProStatus(database, input.uid, config);
    if (await isAccountDeleting(database, input.uid, input.pidKey)) {
      throw new Error('The account is being deleted.');
    }
    const audit = {
      pidKey: input.pidKey, target: input.target,
      operator: userInfo().username, reason: input.reason,
    };
    const result = await (input.mode === 'grant'
      ? grantPro(database, input.uid, config, audit)
      : revokePro(database, input.uid, config, audit));
    await emitAnalyticsBestEffort(database, input.uid, input.pidKey, config.analyticsEnabled,
      input.mode === 'grant' ? 'pro_granted' : 'pro_revoked', { source: 'operator' });
    return result;
  };
  run().then(result => { process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); })
    .catch(error => {
      process.stderr.write(`Pilot operator failed: ${error instanceof Error ? error.message : 'Unknown error'}\n`);
      process.exitCode = 1;
    });
}
