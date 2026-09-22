import { createHash } from 'node:crypto';
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

  it('derives the exact production script hash-set from executable inline scripts', () => {
    const firebaseJson = JSON.parse(
      readFileSync(new URL('./firebase.json', import.meta.url), 'utf8'),
    ) as { hosting?: { headers?: Array<{ source: string; headers: Array<{ key: string; value: string }> }> } };
    const globalHeaders = firebaseJson.hosting?.headers?.find(rule => rule.source === '**')?.headers ?? [];
    const policy = globalHeaders.find(header => header.key === 'Content-Security-Policy')?.value ?? '';
    const scriptPolicy = policy.split(';').find(directive => directive.trim().startsWith('script-src'))?.trim();
    expect(scriptPolicy).toBeDefined();
    const tokens = scriptPolicy!.split(/\s+/).slice(1);
    const hashLikeTokens = tokens.filter(token => token.includes('sha256-'));
    const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
    const executableScripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(([, attributes]) => {
      const type = attributes.match(/\btype\s*=\s*(["'])(.*?)\1/i)?.[2]?.split(';', 1)[0].trim().toLowerCase();
      return !/\bsrc\s*=/.test(attributes) && (!type || type === 'module' || /^(?:application|text)\/javascript$/.test(type));
    }).map(([, , source]) => `'sha256-${createHash('sha256').update(source).digest('base64')}'`);

    expect(hashLikeTokens.every(token => /^'sha256-[A-Za-z0-9+/]+={0,2}'$/.test(token))).toBe(true);
    expect(new Set(hashLikeTokens)).toEqual(new Set(executableScripts));
    expect(hashLikeTokens).toHaveLength(executableScripts.length);
    expect(tokens).not.toContain("'unsafe-inline'");
    expect(tokens).not.toContain("'unsafe-eval'");
  });
});
