import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const normalizeReference = value => {
  if (typeof value !== 'string' || !value.trim()) return null;
  if (/^(?:[a-z]+:|\/\/|#)/i.test(value)) return null;
  const withoutQuery = value.split(/[?#]/, 1)[0].replace(/^\.\//, '');
  const normalized = path.posix.normalize(withoutQuery);
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) return null;
  return normalized;
};

const attributeValue = (tag, attribute) => {
  const match = tag.match(new RegExp(`\\b${attribute}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return match?.[1] ?? null;
};

const manifestReferences = manifest => [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  manifest.options_page,
  manifest.options_ui?.page,
  ...Object.values(manifest.icons ?? {}),
  ...(manifest.content_scripts ?? []).flatMap(script => [
    ...(script.js ?? []),
    ...(script.css ?? []),
  ]),
  ...(manifest.web_accessible_resources ?? []).flatMap(resource => resource.resources ?? []),
].filter(Boolean);

const htmlReferences = source => {
  const references = [];
  for (const match of source.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)) references.push(match[1]);
  for (const match of source.matchAll(/<link\b[^>]*>/gi)) {
    if (/\brel\s*=\s*["']stylesheet["']/i.test(match[0])) references.push(attributeValue(match[0], 'href'));
  }
  return references.filter(Boolean);
};

const javascriptReferences = source => {
  const references = [];
  for (const call of source.matchAll(/\bimportScripts\s*\(([^)]*)\)/g)) {
    for (const match of call[1].matchAll(/["']([^"']+)["']/g)) references.push(match[1]);
  }
  return references;
};

const stylesheetReferences = source => [...source.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)]
  .map(match => match[1]);

export const collectExtensionFiles = async (extensionRoot, suppliedManifest = null) => {
  const manifest = suppliedManifest ?? JSON.parse(await readFile(path.join(extensionRoot, 'manifest.json'), 'utf8'));
  const files = new Map();
  const pending = [...manifestReferences(manifest)];

  const add = async reference => {
    const relative = normalizeReference(reference);
    if (!relative || files.has(relative)) return;
    const absolute = path.join(extensionRoot, ...relative.split('/'));
    const details = await stat(absolute);
    if (!details.isFile()) throw new Error(`Extension package reference is not a file: ${relative}`);
    files.set(relative, { absolute, relative });
    const source = await readFile(absolute, 'utf8').catch(() => '');
    if (relative.endsWith('.html')) pending.push(...htmlReferences(source));
    else if (relative.endsWith('.js')) pending.push(...javascriptReferences(source));
    else if (relative.endsWith('.css')) pending.push(...stylesheetReferences(source));
  };

  await add('manifest.json');
  while (pending.length) await add(pending.shift());
  return [...files.values()].sort((left, right) => left.relative.localeCompare(right.relative));
};

export const readZipEntryNames = async zipPath => {
  const archive = await readFile(zipPath);
  let endOffset = -1;
  for (let offset = archive.length - 22; offset >= 0; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054B50) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error(`Invalid extension ZIP: ${zipPath}`);
  const count = archive.readUInt16LE(endOffset + 8);
  const centralSize = archive.readUInt32LE(endOffset + 12);
  const centralOffset = archive.readUInt32LE(endOffset + 16);
  const names = [];
  let offset = centralOffset;
  const centralEnd = centralOffset + centralSize;
  for (let index = 0; index < count && offset < centralEnd; index += 1) {
    if (archive.readUInt32LE(offset) !== 0x02014B50) throw new Error(`Invalid ZIP central directory: ${zipPath}`);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    names.push(archive.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (names.length !== count) throw new Error(`Truncated extension ZIP: ${zipPath}`);
  return names;
};

export const assertZipMatchesFiles = async (zipPath, files) => {
  const expected = new Set(files.map(file => file.relative));
  const actual = await readZipEntryNames(zipPath);
  const unexpectedJavaScript = actual.filter(name => /\.m?js$/i.test(name) && !expected.has(name));
  if (unexpectedJavaScript.length) {
    throw new Error(`Extension ZIP contains unused JavaScript: ${unexpectedJavaScript.join(', ')}`);
  }
  const actualSet = new Set(actual);
  const missing = [...expected].filter(name => !actualSet.has(name));
  const extra = actual.filter(name => !expected.has(name));
  if (missing.length || extra.length) {
    throw new Error(`Extension ZIP does not match the reachable package graph. Missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'}.`);
  }
};
