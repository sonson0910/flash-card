import { spawnSync } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('starter catalog generator safety', () => {
  it('does not recursively delete shared public directories or hard-code a mutable release id', async () => {
    const source = await readFile(new URL('./generate-starter-catalog.ts', import.meta.url), 'utf8');

    expect(source).not.toMatch(/\brm\s*\(/);
    expect(source).not.toContain('recursive: true');
    expect(source).not.toContain("releaseId: 'starter-v1'");
    expect(source).toContain('createEnglishStarterCatalogDraft');
  });

  it('does not ship the previously generated draft as a public reviewed release', async () => {
    await expect(access(new URL('../public/catalog/english-core/release-manifest.json', import.meta.url)))
      .rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(new URL('../public/english-core/starter-v1/chunk-0000.json', import.meta.url)))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('successfully validates and summarizes the draft without writing public artifacts', () => {
    const result = spawnSync('npm', ['run', 'catalog:starter', '--silent'], {
      cwd: path.resolve('.'), encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'draft-valid', catalogId: 'english-core', publishable: false,
      writesPublicAssets: false,
    });
  });
});
