import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const build = spawnSync(process.execPath, [path.join(root, 'scripts', 'build-browser-extension.mjs')], {
  cwd: root,
  stdio: 'inherit',
});
if (build.status !== 0) process.exit(build.status ?? 1);

if (process.platform !== 'darwin') {
  console.error([
    'Safari packaging requires macOS for the local Apple command-line tools.',
    'The cross-browser WebExtension ZIP was built successfully and can be loaded directly',
    'as a temporary extension in current macOS Safari, or uploaded to Safari Web Extension',
    'Packager in App Store Connect for TestFlight/App Store distribution.',
  ].join(' '));
  process.exit(1);
}

const extensionRoot = path.join(root, 'artifacts', 'browser-extension', 'lingoflash');
const hasTool = name => spawnSync('xcrun', ['--find', name], { encoding: 'utf8' }).status === 0;

if (hasTool('safari-web-extension-packager')) {
  const result = spawnSync('xcrun', [
    'safari-web-extension-packager',
    extensionRoot,
  ], {
    cwd: path.join(root, 'artifacts', 'browser-extension'),
    stdio: 'inherit',
  });
  process.exit(result.status ?? 1);
}

if (hasTool('safari-web-extension-converter')) {
  const projectRoot = path.join(root, 'artifacts', 'browser-extension', 'safari-xcode');
  const result = spawnSync('xcrun', [
    'safari-web-extension-converter',
    extensionRoot,
    '--project-location',
    projectRoot,
  ], {
    cwd: root,
    stdio: 'inherit',
  });
  process.exit(result.status ?? 1);
}

console.error([
  'No Safari Web Extension packaging tool was found.',
  'Install or update Xcode Command Line Tools, or upload the generated ZIP to',
  'Safari Web Extension Packager in App Store Connect.',
].join(' '));
process.exit(1);
