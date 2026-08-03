import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type FirebaseTarget = { predeploy?: string[] };

describe('Firebase deploy gate configuration', () => {
  it('routes every deployable Firebase target through the shared verified gate', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
    ) as { scripts?: Record<string, string> };
    const firebaseJson = JSON.parse(
      readFileSync(new URL('./firebase.json', import.meta.url), 'utf8'),
    ) as {
      functions?: FirebaseTarget;
      firestore?: FirebaseTarget[];
      hosting?: FirebaseTarget;
    };

    expect(packageJson.scripts?.['verify:deploy']).toBe(
      'npm run verify:core && npm run verify:audit',
    );
    expect(packageJson.scripts?.['predeploy:functions']).toBe('npm run verify:deploy');
    expect(packageJson.scripts?.['predeploy:firestore']).toBe('npm run verify:deploy');
    expect(packageJson.scripts?.['predeploy:hosting']).toBe(
      'npm run verify:deploy && npm run build:release && npm run verify:secrets && npm run verify:bundle',
    );

    expect(firebaseJson.functions?.predeploy).toEqual(['npm run predeploy:functions']);
    expect(firebaseJson.firestore?.[0]?.predeploy).toEqual(['npm run predeploy:firestore']);
    expect(firebaseJson.hosting?.predeploy).toEqual(['npm run predeploy:hosting']);
  });
});
