import { describe, expect, it } from 'vitest';
import { validatePilotOperatorRequest } from '../src/pilotOperator.js';
import { validatePilotTarget } from '../src/pilotTarget.js';

const base = {
  PILOT_TARGET: 'staging', FIREBASE_PROJECT_ID: 'sonflash-staging-20260906',
  FIRESTORE_DATABASE_ID: 'ai-studio-945b4052-4462-4668-8936-277f09f07a37',
  PILOT_OPERATOR_MODE: 'grant', PILOT_OPERATOR_UID: 'learner-1',
  PILOT_OPERATOR_CONFIRMATION: 'grant:staging', PILOT_OPERATOR_REASON: 'Pilot access',
  ANALYTICS_PSEUDONYM_KEY: 'x'.repeat(32),
};

describe('pilot operator target and confirmation', () => {
  it('accepts the sealed pair and binds confirmation to mode and environment', () => {
    expect(validatePilotOperatorRequest(base)).toMatchObject({ mode: 'grant', uid: 'learner-1', target: 'staging' });
    expect(() => validatePilotOperatorRequest({ ...base, PILOT_OPERATOR_MODE: 'revoke' })).toThrow();
    expect(() => validatePilotOperatorRequest({ ...base, PILOT_OPERATOR_CONFIRMATION: 'grant:production' })).toThrow();
    expect(() => validatePilotOperatorRequest({ ...base, PILOT_OPERATOR_UID: '../another' })).toThrow();
  });

  it('rejects unknown, mismatched and implicit project/database combinations', () => {
    expect(() => validatePilotTarget({ ...base, PILOT_TARGET: 'production' })).toThrow();
    expect(() => validatePilotTarget({ ...base, FIREBASE_PROJECT_ID: 'unexpected' })).toThrow();
    expect(() => validatePilotTarget({ ...base, FIRESTORE_DATABASE_ID: '(default)' })).toThrow();
    expect(() => validatePilotTarget({ ...base, PILOT_TARGET: '' })).toThrow();
  });

  it('requires a bounded reason and pseudonym key for mutations', () => {
    expect(() => validatePilotOperatorRequest({ ...base, PILOT_OPERATOR_REASON: '' })).toThrow();
    expect(() => validatePilotOperatorRequest({ ...base, ANALYTICS_PSEUDONYM_KEY: '' })).toThrow();
    expect(validatePilotOperatorRequest({ ...base, PILOT_OPERATOR_MODE: 'status',
      PILOT_OPERATOR_CONFIRMATION: 'status:staging', PILOT_OPERATOR_REASON: '', ANALYTICS_PSEUDONYM_KEY: '',
    }).mode).toBe('status');
  });
});
