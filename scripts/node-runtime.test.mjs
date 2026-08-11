import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { validateNodeRuntime } from './verify-node-runtime.mjs';

describe('Node runtime enforcement', () => {
  it('accepts Node 22 and rejects other major versions', () => {
    expect(validateNodeRuntime('22.18.0')).toEqual([]);
    expect(validateNodeRuntime('24.15.0')).toEqual([
      'Node.js 22.x is required; received 24.15.0.',
    ]);
  });

  it('rejects malformed runtime versions', () => {
    expect(validateNodeRuntime('current')).toEqual([
      'Node.js 22.x is required; received current.',
    ]);
  });

  it('pins and enforces Node 22 for both clean installs', () => {
    const root = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const functions = JSON.parse(fs.readFileSync(new URL('../functions/package.json', import.meta.url), 'utf8'));
    expect(fs.readFileSync(new URL('../.nvmrc', import.meta.url), 'utf8').trim()).toBe('22');
    expect(root.scripts.preinstall).toBe('node scripts/verify-node-runtime.mjs');
    expect(functions.scripts.preinstall).toContain("major !== '22'");
    expect(functions.scripts.preinstall).not.toMatch(/\.\.[/\\]/);
  });
});
