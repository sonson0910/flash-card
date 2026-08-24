import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertZipMatchesFiles,
  collectExtensionFiles,
  readExtensionManifest,
} from '../../../scripts/browser-extension-package.mjs';

const extensionRoot = fileURLToPath(new URL('..', import.meta.url));
const expectedFiles = [
  'app-bridge.js',
  'background-core.js',
  'background-ui.js',
  'background.js',
  'icons/icon-128.png',
  'icons/icon-16.png',
  'icons/icon-32.png',
  'icons/icon-48.png',
  'manifest.json',
  'popup.css',
  'popup.html',
  'popup.js',
  'shared.js',
].sort();

test('packages only manifest and HTML reachable extension files', async () => {
  const files = await collectExtensionFiles(extensionRoot);
  const names = files.map(file => file.relative).sort();

  assert.deepEqual(names, expectedFiles);
  assert.equal(names.some(name => name.includes('background-v132')), false);
  assert.equal(names.some(name => name.startsWith('options')), false);
  assert.ok(files.every(file => file.absolute === path.join(extensionRoot, file.relative)));
});

test('rejects symbolic links before reading extension package files', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'lingoflash-extension-'));
  const packageRoot = path.join(tempRoot, 'extension');
  const outside = path.join(tempRoot, 'outside.js');
  try {
    await mkdir(packageRoot);
    await writeFile(outside, 'globalThis.outside = true;\n');
    await writeFile(path.join(packageRoot, 'manifest.json'), JSON.stringify({
      manifest_version: 3,
      background: { service_worker: 'linked.js' },
    }));
    await symlink(outside, path.join(packageRoot, 'linked.js'));

    await assert.rejects(() => collectExtensionFiles(packageRoot), /symbolic link/i);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('rejects a symbolic-link manifest before parsing it', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'lingoflash-extension-'));
  const packageRoot = path.join(tempRoot, 'extension');
  const outsideManifest = path.join(tempRoot, 'manifest.json');
  try {
    await mkdir(packageRoot);
    await writeFile(outsideManifest, JSON.stringify({ manifest_version: 3 }));
    await symlink(outsideManifest, path.join(packageRoot, 'manifest.json'));

    await assert.rejects(() => readExtensionManifest(packageRoot), /symbolic link/i);
    await assert.rejects(() => collectExtensionFiles(packageRoot), /symbolic link/i);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('checks the complete package graph before executing extension files', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'lingoflash-extension-'));
  const packageRoot = path.join(tempRoot, 'extension');
  const outside = path.join(tempRoot, 'outside.js');
  try {
    await cp(extensionRoot, packageRoot, { recursive: true });
    await writeFile(outside, 'globalThis.outside = true;\n');
    await unlink(path.join(packageRoot, 'background-core.js'));
    await symlink(outside, path.join(packageRoot, 'background-core.js'));

    const result = spawnSync(process.execPath, ['scripts/check-browser-extension.mjs'], {
      cwd: path.resolve(extensionRoot, '../..'),
      encoding: 'utf8',
      env: { ...process.env, LINGOFLASH_EXTENSION_ROOT: packageRoot },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /symbolic link/i);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

const createEmptyZip = names => {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const name of names) {
    const encodedName = Buffer.from(name, 'utf8');
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034B50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(encodedName.length, 26);
    localParts.push(localHeader, encodedName);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014B50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(encodedName.length, 28);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, encodedName);
    localOffset += localHeader.length + encodedName.length;
  }
  const localData = Buffer.concat(localParts);
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054B50, 0);
  end.writeUInt16LE(names.length, 8);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localData.length, 16);
  return Buffer.concat([localData, centralDirectory, end]);
};

test('rejects a ZIP containing JavaScript outside the reachable package graph', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'lingoflash-extension-'));
  const zipPath = path.join(tempRoot, 'mutated.zip');
  try {
    await writeFile(zipPath, createEmptyZip(['manifest.json', 'unexpected.js']));
    await assert.rejects(
      () => assertZipMatchesFiles(zipPath, [{ relative: 'manifest.json' }]),
      /Extension ZIP contains unused JavaScript: unexpected\.js/,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
