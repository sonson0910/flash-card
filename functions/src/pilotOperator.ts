import { userInfo } from 'node:os';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { grantPro, OPERATOR_AUDIT_TTL_MS, readProStatus, revokePro } from './entitlements.js';
import { loadPilotConfig } from './pilotConfig.js';
import { validatePilotTarget } from './pilotTarget.js';
import { emitAnalyticsBestEffort } from './analyticsEvents.js';
import { isAccountDeleting, resumeAccountDeletion } from './accountData.js';
import { getAuth } from 'firebase-admin/auth';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import type { PilotTarget } from './pilotTarget.js';

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
  if (mode !== 'status' && (!reason || reason.length > 280
    || (mode !== 'resume-deletion' && pidKey.length < 32))) {
    throw new Error('Mutations require a bounded PILOT_OPERATOR_REASON; grant/revoke also require ANALYTICS_PSEUDONYM_KEY.');
  }
  return { ...target, mode: mode as OperatorMode, uid, pid, reason, pidKey };
}

export async function resumeDeletionWithAudit(database: Firestore, auth: Auth, input: {
  pid: string; reason: string; target: PilotTarget; operator: string;
}, now = new Date()): Promise<'waiting' | 'done'> {
  const auditRef = database.collection('operator_audit').doc();
  await auditRef.create({ mode: 'resume-deletion', pid: input.pid, reason: input.reason,
    target: input.target, operator: input.operator, at: now, result: { status: 'started' },
    expiresAt: new Date(now.getTime() + OPERATOR_AUDIT_TTL_MS) });
  let status: 'waiting' | 'done';
  try {
    status = await resumeAccountDeletion(database, auth, input.pid, now);
  } catch (error) {
    try {
      await auditRef.update({ result: {
        status: 'failed', errorName: error instanceof Error ? error.name : 'UnknownError',
      } });
    } catch {
      // The started record still identifies the attempted mutation for operator follow-up.
    }
    throw error;
  }
  await auditRef.update({ result: { status } });
  return status;
}

if (require.main === module) {
  const input = validatePilotOperatorRequest(process.env);
  const app = getApps()[0] ?? initializeApp({ projectId: input.projectId });
  const database = getFirestore(app, input.databaseId);
  const run = async () => {
    if (input.mode === 'resume-deletion') {
      return { status: await resumeDeletionWithAudit(database, getAuth(app), {
        pid: input.pid, reason: input.reason, target: input.target,
        operator: userInfo().username,
      }) };
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
