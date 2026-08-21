import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execFile = promisify(execFileCallback);
const extensionSource = fileURLToPath(new URL('..', import.meta.url));
const checkScript = fileURLToPath(new URL('../../../scripts/check-browser-extension.mjs', import.meta.url));

const runCheckWithMutation = async (file, mutate, expectedMessage = `${file} version must match manifest\\.version`) => {
  const root = await mkdtemp(path.join(tmpdir(), 'lingoflash-extension-check-'));
  const extensionRoot = path.join(root, 'lingoflash');
  try {
    await cp(extensionSource, extensionRoot, { recursive: true });
    const target = path.join(extensionRoot, file);
    await writeFile(target, mutate(await readFile(target, 'utf8')));
    await assert.rejects(
      execFile(process.execPath, [checkScript], {
        env: { ...process.env, LINGOFLASH_EXTENSION_ROOT: extensionRoot },
      }),
      error => {
        assert.match(error.stderr, new RegExp(expectedMessage));
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

test('release guard rejects popup and README version drift', async () => {
  await runCheckWithMutation('popup.html', source => source.replace('v1.6.0', 'v1.6.1'));
  await runCheckWithMutation('README.md', source => source.replace('v1.6.0', 'v1.6.1'));
});

test('release guard rejects an extension that drops the v3 ticket contract', async () => {
  await runCheckWithMutation(
    'shared.js',
    source => source.replace('const IMPORT_PROTOCOL_V3 = 3', 'const IMPORT_PROTOCOL_V3 = 4'),
    'extension import protocol v3 ticket support is missing',
  );
});

test('release guard rejects broad mandatory or incomplete optional host access', async () => {
  await runCheckWithMutation(
    'manifest.json',
    source => source.replace('"https://translate.googleapis.com/*"\n  ],', '"https://translate.googleapis.com/*",\n    "https://*/*"\n  ],'),
    'host_permissions must contain only LingoFlash production and Google Translate fallback origins',
  );
  await runCheckWithMutation(
    'manifest.json',
    source => source.replace('"http://*/*",\n    "https://*/*"', '"https://*/*"'),
    'optional_host_permissions must contain only the explicit http\\(s\\) site opt-in patterns',
  );
});
