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

const runCheckWithMutation = async (file, mutate) => {
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
        assert.match(error.stderr, new RegExp(`${file} version must match manifest\\.version`));
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

test('release guard rejects popup and README version drift', async () => {
  await runCheckWithMutation('popup.html', source => source.replace('v1.3.3', 'v1.3.4'));
  await runCheckWithMutation('README.md', source => source.replace('v1.3.3', 'v1.3.4'));
});
