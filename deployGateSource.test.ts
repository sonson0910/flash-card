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

  it('validates a workflow-dispatch revision through a quoted environment variable before checkout', () => {
    const workflow = readFileSync(
      new URL('./.github/workflows/deploy-production.yml', import.meta.url),
      'utf8',
    );
    const environmentBinding = workflow.indexOf('REVISION: ${{ inputs.revision }}');
    const validation = workflow.indexOf(
      'if [[ ! "$REVISION" =~ ^([0-9a-f]{40}|[0-9a-f]{64})$ ]]',
    );
    const checkout = workflow.indexOf('actions/checkout@');

    expect(environmentBinding).toBeGreaterThan(-1);
    expect(validation).toBeGreaterThan(environmentBinding);
    expect(checkout).toBeGreaterThan(validation);
    expect(workflow).not.toContain('if [[ ! "${{ inputs.revision }}"');
  });

  it('forces mutable catalog release manifests to revalidate', () => {
    const firebaseJson = JSON.parse(
      readFileSync(new URL('./firebase.json', import.meta.url), 'utf8'),
    ) as { hosting?: { headers?: Array<{ source: string; headers: Array<{ key: string; value: string }> }> } };
    const manifests = firebaseJson.hosting?.headers?.filter(rule => (
      rule.source.endsWith('/release-manifest.json')
    )) ?? [];

    expect(manifests).toHaveLength(2);
    expect(manifests.every(rule => rule.headers.some(header => (
      header.key === 'Cache-Control' && header.value === 'no-cache,no-store,must-revalidate'
    )))).toBe(true);
  });

  it('forces every SPA entry URL to revalidate before loading hashed assets', () => {
    const firebaseJson = JSON.parse(
      readFileSync(new URL('./firebase.json', import.meta.url), 'utf8'),
    ) as { hosting?: { headers?: Array<{ source: string; headers: Array<{ key: string; value: string }> }> } };
    const noCacheSources = new Set((firebaseJson.hosting?.headers ?? []).filter(rule => (
      rule.headers.some(header => (
        header.key === 'Cache-Control' && header.value === 'no-cache,no-store,must-revalidate'
      ))
    )).map(rule => rule.source));

    expect([...noCacheSources]).toEqual(expect.arrayContaining(['/index.html', '/']));
  });

  it('allows only the hashed inline theme bootstrap in the production script policy', () => {
    const firebaseJson = JSON.parse(
      readFileSync(new URL('./firebase.json', import.meta.url), 'utf8'),
    ) as { hosting?: { headers?: Array<{ source: string; headers: Array<{ key: string; value: string }> }> } };
    const globalHeaders = firebaseJson.hosting?.headers?.find(rule => rule.source === '**')?.headers ?? [];
    const policy = globalHeaders.find(header => header.key === 'Content-Security-Policy')?.value ?? '';
    const scriptPolicy = policy.split(';').find(directive => directive.trim().startsWith('script-src')) ?? '';

    expect(scriptPolicy).toContain("'sha256-LMIPsVsaeB8ksU5/u/EXOPvuYE1Leb+bs4vepRJfOAA='");
    expect(scriptPolicy).not.toContain("'unsafe-inline'");
  });
});
