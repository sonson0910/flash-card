import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionRoot = path.join(root, 'extensions', 'lingoflash');
const fail = message => { console.error(`Extension check failed: ${message}`); process.exit(1); };
const manifest = JSON.parse(await readFile(path.join(extensionRoot, 'manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3) fail('manifest_version must be 3.');
if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(manifest.version)) fail('manifest version must use x.y.z format.');
if (manifest.host_permissions?.length) fail('broad host_permissions are intentionally forbidden.');
const allowedPermissions = new Set(['activeTab', 'contextMenus', 'scripting', 'storage']);
for (const permission of manifest.permissions ?? []) if (!allowedPermissions.has(permission)) fail(`unexpected permission: ${permission}`);
for (const permission of allowedPermissions) if (!(manifest.permissions ?? []).includes(permission)) fail(`missing permission: ${permission}`);
const command = manifest.commands?.['translate-selection'];
if (!command?.suggested_key?.default || !command.suggested_key.mac) fail('keyboard shortcut suggestions must cover default and macOS.');
if (manifest.background?.service_worker !== 'background.js') fail('background service worker is missing.');
if (manifest.action?.default_popup !== 'popup.html') fail('popup is missing.');
if (manifest.incognito !== 'not_allowed') fail('incognito must remain disabled for selected-text privacy.');
for (const file of ['background.js','shared.js','popup.html','popup.css','popup.js','options.html','options.css','options.js']) {
  await readFile(path.join(extensionRoot, file), 'utf8');
}
const signature = Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]);
for (const size of [16,32,48,128]) {
  const icon = await readFile(path.join(extensionRoot, 'icons', `icon-${size}.png`));
  if (!icon.subarray(0,8).equals(signature)) fail(`${size}px icon is not a PNG.`);
  if (icon.readUInt32BE(16) !== size || icon.readUInt32BE(20) !== size) fail(`${size}px icon has incorrect dimensions.`);
}
for (const file of ['background.js','shared.js','popup.js','options.js']) {
  const result = spawnSync(process.execPath, ['--check', path.join(extensionRoot, file)], { encoding: 'utf8' });
  if (result.status !== 0) fail(`${file} has invalid JavaScript syntax:\n${result.stderr}`);
}
const sharedSource = await readFile(path.join(extensionRoot, 'shared.js'), 'utf8');
const backgroundSource = await readFile(path.join(extensionRoot, 'background.js'), 'utf8');
const appProtocolSource = await readFile(path.join(root, 'src/features/browserExtension/browserExtensionImport.ts'), 'utf8');
if (!sharedSource.includes("const IMPORT_HASH_KEY = 'lf-import'")) fail('extension import key changed unexpectedly.');
if (!appProtocolSource.includes("BROWSER_EXTENSION_IMPORT_HASH_KEY = 'lf-import'")) fail('app import key no longer matches the extension.');
if (/\beval\s*\(|new\s+Function\s*\(/.test(sharedSource + backgroundSource)) fail('dynamic code execution is forbidden.');
if (!backgroundSource.includes("contexts: ['selection']")) fail('selection-only context menu is missing.');
console.log(`LingoFlash extension ${manifest.version} passed manifest, permission, icon, syntax, and protocol checks.`);
