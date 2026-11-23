import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { findProtocolDrift, readConstant } from '../../../scripts/extension-protocol-parity.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const extensionSource = path.join(repoRoot, 'extensions', 'lingoflash');

test('reads plain literals from JavaScript and TypeScript declarations', () => {
  assert.equal(readConstant("  const KEY = 'lf-import';", 'KEY'), '"lf-import"');
  assert.equal(readConstant('export const VERSION: number = 3;', 'VERSION'), '3');
  assert.equal(readConstant('export const MAX_AGE_MS = 24 * 60 * 60 * 1_000;', 'MAX_AGE_MS'), '86400000');
  assert.equal(readConstant('const NONCE = /^[A-Za-z0-9_-]{22,64}$/;', 'NONCE'), '/^[A-Za-z0-9_-]{22,64}$/');
  assert.equal(readConstant("const LANGUAGES = ['en', 'ko'];", 'LANGUAGES'), '["en","ko"]');
  assert.equal(readConstant("export const LANGUAGES = Object.freeze(['en', 'ko'] as const);", 'LANGUAGES'), '["en","ko"]');
  assert.throws(() => readConstant('const LIMIT = compute();', 'LIMIT'), /not a plain literal/);
  assert.throws(() => readConstant('const OTHER = 1;', 'LIMIT'), /not declared/);
});

test('reports a constant that differs between the extension and the app, and one that cannot be read', () => {
  const sources = {
    'bridge.js': "const KEY = 'lingoflash_import';\nconst VERSION = 3;",
    'app.ts': "export const APP_KEY = 'sonflash_import';\nexport const APP_VERSION = 3;",
    'index.html': '<meta name="runtime" content="3" />',
  };
  const groups = [
    { label: 'storage key', entries: [{ file: 'bridge.js', name: 'KEY' }, { file: 'app.ts', name: 'APP_KEY' }] },
    {
      label: 'version',
      entries: [
        { file: 'bridge.js', name: 'VERSION' },
        { file: 'app.ts', name: 'APP_VERSION' },
        { file: 'index.html', pattern: /<meta name="runtime" content="([^"]*)"/ },
      ],
    },
    { label: 'missing', entries: [{ file: 'bridge.js', name: 'ABSENT' }] },
  ];
  const problems = findProtocolDrift(sources, groups);
  assert.equal(problems.length, 2);
  assert.match(problems[0], /storage key differs/);
  assert.match(problems[0], /"lingoflash_import"/);
  assert.match(problems[0], /"sonflash_import"/);
  assert.match(problems[1], /cannot read bridge\.js ABSENT/);
  assert.deepEqual(findProtocolDrift(sources, groups.slice(1, 2)), []);
});

const runCheck = extensionRoot => spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'check-browser-extension.mjs')], {
  cwd: repoRoot,
  encoding: 'utf8',
  env: { ...process.env, LINGOFLASH_EXTENSION_ROOT: extensionRoot },
});

test('the extension check fails when the bridge keeps a verified import key the app no longer reads', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'extension-protocol-parity-'));
  try {
    const copy = path.join(directory, 'extension');
    cpSync(extensionSource, copy, { recursive: true });
    const baseline = runCheck(copy);
    assert.equal(baseline.status, 0, baseline.stderr);

    const bridgePath = path.join(copy, 'app-bridge.js');
    const original = readFileSync(bridgePath, 'utf8');
    const drifted = original.replace(
      "const IMPORT_STORAGE_KEY = 'lingoflash_browser_extension_import';",
      "const IMPORT_STORAGE_KEY = 'sonflash_browser_extension_import';",
    );
    assert.notEqual(drifted, original);
    writeFileSync(bridgePath, drifted);
    const result = runCheck(copy);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /verified import storage key differs/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
