import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectExtensionFiles } from '../../../scripts/browser-extension-package.mjs';

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
