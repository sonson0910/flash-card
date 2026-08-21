import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertZipMatchesFiles, collectExtensionFiles } from '../../../scripts/browser-extension-package.mjs';

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
