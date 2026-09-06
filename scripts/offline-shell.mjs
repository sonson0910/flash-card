import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const OFFLINE_SHELL_MAX_BYTES = 4 * 1024 * 1024;
export const OFFLINE_SHELL_DESCRIPTOR_MARKER = '/* SONFLASH_OFFLINE_SHELL_DESCRIPTOR */ null';

const SHELL_ASSET_PATTERN = /\.(?:css|eot|html?|js|otf|ttf|woff2?)$/i;
const PRIVACY_ASSET_PATTERN = /(?:^|\/)(?:browser-extension-)?privacy(?:[-/.]|$)/i;
const PROTECTED_SHELL_PATH_PATTERN = /^(?:\/(?:api|auth|catalog|private|media|audio-pack|__sonflash_offline_media_pack__)(?:[/.]|$)|\/__\/|\/(?:health|manifest)(?:[/.]|$))/i;

const compareStrings = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

const fail = message => {
  throw new Error(`Invalid offline shell: ${message}`);
};

const canonicalAssetUrl = value => {
  if (typeof value !== 'string' || value.length === 0) fail('asset URL must be a non-empty string');
  if (/^(?:https?:)?\/\//i.test(value)) fail(`asset URL must be same-origin: ${value}`);
  if (value.includes('?') || value.includes('#') || value.includes('%') || value.includes('\\')) {
    fail(`asset URL must not contain query, fragment, encoding, or backslash: ${value}`);
  }
  const url = value.startsWith('/') ? value : `/${value}`;
  const segments = url.slice(1).split('/');
  if (segments.length === 0 || segments.some(segment => segment.length === 0 || segment === '.' || segment === '..')) {
    fail(`asset URL contains traversal or empty path segments: ${value}`);
  }
  return `/${segments.join('/')}`;
};

const assertInsideDirectory = (directory, filePath, url) => {
  const resolvedDirectory = path.resolve(directory);
  const resolvedFile = path.resolve(filePath);
  const relative = path.relative(resolvedDirectory, resolvedFile);
  if (relative === '' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail(`asset path escapes dist: ${url}`);
  }
  let directoryRealPath;
  let fileRealPath;
  try {
    directoryRealPath = fs.realpathSync(resolvedDirectory);
    fileRealPath = fs.realpathSync(resolvedFile);
  } catch {
    fail(`asset is missing: ${url}`);
  }
  const realRelative = path.relative(directoryRealPath, fileRealPath);
  if (realRelative === '' || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
    fail(`asset path escapes dist: ${url}`);
  }
};

const filePathForAssetUrl = (distDirectory, url) => {
  const relativePath = url.slice(1).split('/').join(path.sep);
  const filePath = path.resolve(distDirectory, relativePath);
  assertInsideDirectory(distDirectory, filePath, url);
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch {
    fail(`asset is missing: ${url}`);
  }
  if (stat.isSymbolicLink()) fail(`asset must not be a symbolic link: ${url}`);
  if (!stat.isFile()) fail(`asset is not a regular file: ${url}`);
  return filePath;
};

const isAllowedShellAsset = url => (
  SHELL_ASSET_PATTERN.test(url)
  && url !== '/sw.js'
  && !PRIVACY_ASSET_PATTERN.test(url)
  && !PROTECTED_SHELL_PATH_PATTERN.test(url)
);

const shouldInclude = relativePath => isAllowedShellAsset(`/${relativePath}`);

const collectFiles = (directory, rootDirectory, output) => {
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    fail(`cannot read ${directory}: ${error instanceof Error ? error.message : String(error)}`);
  }
  entries.sort((left, right) => compareStrings(left.name, right.name));
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    const relativePath = path.relative(rootDirectory, filePath).split(path.sep).join('/');
    if (entry.isSymbolicLink()) fail(`symbolic link is not allowed: ${relativePath}`);
    if (entry.isDirectory()) {
      collectFiles(filePath, rootDirectory, output);
    } else if (entry.isFile() && shouldInclude(relativePath)) {
      output.push(`/${relativePath}`);
    }
  }
};

export function collectOfflineShellAssetUrls(distDirectory = path.resolve('dist')) {
  const rootDirectory = path.resolve(distDirectory);
  let stat;
  try {
    stat = fs.lstatSync(rootDirectory);
  } catch {
    fail(`dist directory is missing: ${rootDirectory}`);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail(`dist is not a regular directory: ${rootDirectory}`);
  const output = [];
  collectFiles(rootDirectory, rootDirectory, output);
  return output.sort(compareStrings);
}

const sha256Hex = value => crypto.createHash('sha256').update(value).digest('hex');

export function assertOfflineShellDescriptor(descriptor) {
  if (typeof descriptor !== 'object' || descriptor === null || Array.isArray(descriptor)) {
    fail('descriptor must be an object');
  }
  if (typeof descriptor.revision !== 'string' || descriptor.revision.length === 0) {
    fail('revision must be a non-empty string');
  }
  if (!/^[a-f0-9]{64}$/.test(descriptor.fingerprint)) fail('fingerprint must be a SHA-256 digest');
  if (!Array.isArray(descriptor.assets) || descriptor.assets.length === 0) fail('assets must be non-empty');
  const urls = new Set();
  let totalBytes = 0;
  for (const asset of descriptor.assets) {
    if (typeof asset !== 'object' || asset === null || Array.isArray(asset)) fail('asset must be an object');
    const url = canonicalAssetUrl(asset.url);
    if (urls.has(url)) fail(`duplicate asset URL: ${url}`);
    if (!isAllowedShellAsset(url)) fail(`asset is outside the shell allowlist: ${url}`);
    urls.add(url);
    if (!/^[a-f0-9]{64}$/.test(asset.sha256)) fail(`invalid asset digest: ${url}`);
    if (!Number.isSafeInteger(asset.bytes) || asset.bytes < 0) fail(`invalid asset byte count: ${url}`);
    totalBytes += asset.bytes;
  }
  if (totalBytes > OFFLINE_SHELL_MAX_BYTES) {
    fail(`shell exceeds ${OFFLINE_SHELL_MAX_BYTES} bytes`);
  }
  return descriptor;
}

export function createOfflineShellDescriptor({
  distDirectory = path.resolve('dist'),
  revision = 'local',
  assetUrls,
  assetPaths,
  maximumBytes = OFFLINE_SHELL_MAX_BYTES,
} = {}) {
  if (typeof revision !== 'string' || revision.trim().length === 0) fail('revision must be a non-empty string');
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) fail('maximumBytes must be a positive safe integer');
  const requestedUrls = assetUrls ?? assetPaths ?? collectOfflineShellAssetUrls(distDirectory);
  if (!Array.isArray(requestedUrls) || requestedUrls.length === 0) fail('no shell assets found');
  const urls = requestedUrls.map(canonicalAssetUrl);
  if (new Set(urls).size !== urls.length) fail('duplicate asset URL');
  if (!urls.includes('/index.html')) fail('shell must include /index.html');
  const assets = urls.sort(compareStrings).map(url => {
    const filePath = filePathForAssetUrl(distDirectory, url);
    let content;
    try {
      content = fs.readFileSync(filePath);
    } catch (error) {
      fail(`cannot read asset ${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { url, sha256: sha256Hex(content), bytes: content.byteLength };
  });
  const totalBytes = assets.reduce((total, asset) => total + asset.bytes, 0);
  if (totalBytes > maximumBytes) fail(`shell exceeds ${maximumBytes} bytes`);
  const fingerprint = sha256Hex(JSON.stringify(assets));
  const descriptor = { revision: revision.trim(), fingerprint, assets };
  assertOfflineShellDescriptor(descriptor);
  return descriptor;
}

export function renderOfflineServiceWorker(template, descriptor) {
  assertOfflineShellDescriptor(descriptor);
  if (typeof template !== 'string') fail('service worker template must be a string');
  const markerIndex = template.indexOf(OFFLINE_SHELL_DESCRIPTOR_MARKER);
  if (markerIndex < 0 || markerIndex !== template.lastIndexOf(OFFLINE_SHELL_DESCRIPTOR_MARKER)) {
    fail('service worker template must contain exactly one descriptor marker');
  }
  return template.replace(OFFLINE_SHELL_DESCRIPTOR_MARKER, JSON.stringify(descriptor));
}
