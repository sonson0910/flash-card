import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionRoot = path.join(root, 'extensions', 'lingoflash');
const productionPattern = 'https://encoded-hangout-433912-h2.web.app/*';
const translatePattern = 'https://translate.googleapis.com/*';
const fail = message => { console.error(`Extension check failed: ${message}`); process.exit(1); };
const manifest = JSON.parse(await readFile(path.join(extensionRoot, 'manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3) fail('manifest_version must be 3.');
if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(manifest.version)) fail('manifest version must use x.y.z format.');
const manifestTextLimits = { name: 75, short_name: 12, description: 132 };
for (const [field, limit] of Object.entries(manifestTextLimits)) {
  if (typeof manifest[field] !== 'string' || manifest[field].length > limit) {
    fail(`${field} must be a string of at most ${limit} characters.`);
  }
}
const hostPermissions = manifest.host_permissions ?? [];
if (
  hostPermissions.length !== 2
  || !hostPermissions.includes(productionPattern)
  || !hostPermissions.includes(translatePattern)
) fail('host_permissions must contain only LingoFlash production and Google Translate fallback origins.');
const allowedPermissions = new Set(['activeTab', 'alarms', 'contextMenus', 'scripting', 'storage']);
for (const permission of manifest.permissions ?? []) if (!allowedPermissions.has(permission)) fail(`unexpected permission: ${permission}`);
for (const permission of allowedPermissions) if (!(manifest.permissions ?? []).includes(permission)) fail(`missing permission: ${permission}`);
const command = manifest.commands?.['translate-selection'];
if (!command?.suggested_key?.default || !command.suggested_key.mac) fail('keyboard shortcut suggestions must cover default and macOS.');
if (manifest.background?.service_worker !== 'background-v132.js') fail('v1.3.2 background service worker is missing.');
if (manifest.action?.default_popup !== 'popup.html') fail('popup is missing.');
if (manifest.incognito !== 'not_allowed') fail('incognito must remain disabled for selected-text privacy.');
const bridge = (manifest.content_scripts ?? []).find(candidate => candidate?.js?.includes('app-bridge.js'));
if (!bridge || bridge.run_at !== 'document_start' || bridge.matches?.length !== 1 || bridge.matches[0] !== productionPattern) {
  fail('the production app result bridge must run at document_start on the exact app origin.');
}
const requiredFiles = [
  'background-v132.js','background-v132-ui.js','background-v132-core.js',
  'app-bridge.js','shared.js','popup.html','popup.css','popup.js','options.html','options.css','options.js',
];
for (const file of requiredFiles) await readFile(path.join(extensionRoot, file), 'utf8');
const signature = Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]);
for (const size of [16,32,48,128]) {
  const icon = await readFile(path.join(extensionRoot, 'icons', `icon-${size}.png`));
  if (!icon.subarray(0,8).equals(signature)) fail(`${size}px icon is not a PNG.`);
  if (icon.readUInt32BE(16) !== size || icon.readUInt32BE(20) !== size) fail(`${size}px icon has incorrect dimensions.`);
}
for (const file of ['background-v132.js','background-v132-ui.js','background-v132-core.js','app-bridge.js','shared.js','popup.js','options.js']) {
  const result = spawnSync(process.execPath, ['--check', path.join(extensionRoot, file)], { encoding: 'utf8' });
  if (result.status !== 0) fail(`${file} has invalid JavaScript syntax:\n${result.stderr}`);
}
const sharedSource = await readFile(path.join(extensionRoot, 'shared.js'), 'utf8');
const workerSource = [
  await readFile(path.join(extensionRoot, 'background-v132.js'), 'utf8'),
  await readFile(path.join(extensionRoot, 'background-v132-ui.js'), 'utf8'),
  await readFile(path.join(extensionRoot, 'background-v132-core.js'), 'utf8'),
].join('\n');
const bridgeSource = await readFile(path.join(extensionRoot, 'app-bridge.js'), 'utf8');
const appProtocolSource = await readFile(path.join(root, 'src/features/browserExtension/browserExtensionImport.ts'), 'utf8');
const appRuntimeSource = await readFile(path.join(root, 'src/features/browserExtension/browserExtensionImportRuntime.ts'), 'utf8');
if (!sharedSource.includes("const IMPORT_HASH_KEY = 'lf-import'")) fail('extension import key changed unexpectedly.');
if (!appProtocolSource.includes("BROWSER_EXTENSION_IMPORT_HASH_KEY = 'lf-import'")) fail('app import key no longer matches the extension.');
if (!sharedSource.includes("mode: 'silent'")) fail('silent import payload support is missing.');
if (!workerSource.includes("url:'about:blank'")) fail('race-safe blank worker bootstrap is missing.');
if (!workerSource.includes("extensionApi.tabs,'update'")) fail('worker navigation after durable job storage is missing.');
if (!workerSource.includes('renderInlineBubble')) fail('inline translation renderer is missing.');
if (!workerSource.includes('translate.googleapis.com/translate_a/single')) fail('Google Translate fallback is missing.');
if (!bridgeSource.includes('APP_IMPORT_RESULT')) fail('app result bridge is missing.');
if (!bridgeSource.includes('fallbackThroughLibraryUi')) fail('older Hosting compatibility fallback is missing.');
if (!appRuntimeSource.includes('LINGOFLASH_EXTENSION_RESULT')) fail('web app does not publish extension results.');
if (/\beval\s*\(|new\s+Function\s*\(/.test(sharedSource + workerSource + bridgeSource)) fail('dynamic code execution is forbidden.');
if (!workerSource.includes("contexts:['selection']")) fail('selection-only context menu is missing.');
console.log(`LingoFlash extension ${manifest.version} passed manifest, permission, bridge, icon, syntax, race-safety, and protocol checks.`);
