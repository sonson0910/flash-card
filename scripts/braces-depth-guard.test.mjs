import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const { describe, it } = process.env.VITEST ? await import('vitest') : await import('node:test');
const require = createRequire(import.meta.url);
const cliRequire = createRequire(require.resolve('@lingui/cli'));
const micromatchRequire = createRequire(cliRequire.resolve('micromatch'));
const bracesPath = micromatchRequire.resolve('braces');
const braces = require(bracesPath);

describe('glob parser nesting safety', () => {
  it('keeps nested sets, padded ranges and project globs compatible', () => {
    assert.deepEqual(braces.expand('src/{app,{lib,features}}/*.{ts,tsx}'), [
      'src/app/*.ts', 'src/app/*.tsx', 'src/lib/*.ts', 'src/lib/*.tsx', 'src/features/*.ts', 'src/features/*.tsx',
    ]);
    assert.deepEqual(braces.expand('{01..03}'), ['01', '02', '03']);
    assert.deepEqual(cliRequire('micromatch')(['src/app/a.tsx', 'src/lib/b.ts', 'docs/a.md'], 'src/**/*.{ts,tsx}'), ['src/app/a.tsx', 'src/lib/b.ts']);
  });

  it('rejects excessive nesting and malformed AST cycles before stack exhaustion', () => {
    const result = spawnSync(process.execPath, ['--max-old-space-size=128', '-e', `
      const assert = require('node:assert/strict');
      const braces = require(${JSON.stringify(bracesPath)});
      for (const [open, close] of [['{', '}'], ['(', ')'], ['{(', ')}']]) {
        const input = open.repeat(2000) + 'a,b' + close.repeat(2000);
        for (const method of ['parse', 'compile', 'expand', 'stringify']) {
          assert.throws(() => braces[method](input), /exceeds max depth/);
        }
      }
      let ast = { type: 'text', value: 'a' };
      for (let i = 0; i < 2000; i++) ast = { type: 'brace', nodes: [ast] };
      const root = { type: 'root', nodes: [ast] };
      for (const method of ['compile', 'expand', 'stringify']) {
        assert.throws(() => braces[method](root), /exceeds max depth/);
      }
      const cycle = { type: 'paren', nodes: [] }; cycle.parent = cycle;
      assert.throws(() => braces.expand(cycle), /parent chain contains a cycle/);
      assert.throws(() => braces.parse('a'.repeat(10001), { maxLength: NaN }), /maxLength must be a non-negative number/);
    `], { encoding: 'utf8', timeout: 3000, maxBuffer: 64 * 1024 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
  });
});
