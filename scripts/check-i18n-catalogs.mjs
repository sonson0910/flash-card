import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { formatter } from '@lingui/format-po';

const root = path.resolve('src/i18n/locales');
const run = script => {
  const result = spawnSync('npm', ['run', script], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

const catalogSnapshot = async () => {
  const files = (await readdir(root, { recursive: true })).filter(file => file.endsWith('.po')).sort();
  return new Map(await Promise.all(files.map(async file => [
    file, createHash('sha256').update(await readFile(path.join(root, file))).digest('hex'),
  ])));
};

const poFormatter = formatter();
const parseCatalog = source => new Map(
  Object.entries(poFormatter.parse(source)).map(([id, entry]) => [id, entry.translation]),
);

const before = await catalogSnapshot();
run('i18n:extract');
const after = await catalogSnapshot();
if (JSON.stringify([...before]) !== JSON.stringify([...after])) {
  throw new Error('Catalog extraction changed .po files; run i18n:extract and review the translations.');
}
run('i18n:compile');

const areas = (await readdir(path.join(root, 'en'))).filter(file => file.endsWith('.po'));
for (const area of areas) {
  const english = parseCatalog(await readFile(path.join(root, 'en', area), 'utf8'));
  const vietnamese = parseCatalog(await readFile(path.join(root, 'vi', area), 'utf8'));
  if (english.size !== vietnamese.size || [...english.keys()].some(id => !vietnamese.get(id))) {
    throw new Error(`${area}: Vietnamese catalog is missing an English message ID or translation.`);
  }
}
// Extraction only scans the folders listed in lingui.config.ts, so a message
// in an unlisted folder is silently dropped and renders as its raw id.
const englishMessages = new Map();
const catalogContexts = new Set();
for (const area of areas) {
  const source = await readFile(path.join(root, 'en', area), 'utf8');
  for (const [id, entry] of Object.entries(poFormatter.parse(source))) {
    englishMessages.set(id, entry.translation);
    if (entry.context) catalogContexts.add(entry.context);
    if (entry.message && entry.translation !== entry.message) {
      throw new Error(`${area}: English translation differs from generated message ${id}.`);
    }
  }
}
const catalogIds = new Set(englishMessages.keys());
const sourceFiles = (await readdir('src', { recursive: true }))
  .filter(file => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file));
const orphaned = [];
// Extraction keeps an explicit id's existing English msgstr, so editing the
// source default alone leaves the old English text on screen.
const stale = [];
for (const file of sourceFiles) {
  const source = await readFile(path.join('src', file), 'utf8');
  for (const match of source.matchAll(/(?:msg\(\{\s*id:\s*'([^']+)'|<Trans\s+id="([^"]+)")/g)) {
    const id = match[1] ?? match[2];
    if (!catalogIds.has(id)) orphaned.push(`${file}: ${id}`);
  }
  for (const match of source.matchAll(/msg\(\{\s*context:\s*'([^']+)'/g)) {
    if (!catalogContexts.has(match[1])) orphaned.push(`${file}: ${match[1]}`);
  }
  const defaults = [
    ...[...source.matchAll(/msg\(\{\s*id:\s*'([^']+)',\s*message:\s*'((?:[^'\\]|\\.)*)'/g)]
      .map(match => [match[1], match[2].replace(/\\'/g, "'")]),
    ...[...source.matchAll(/<Trans\s+id="([^"]+)"\s+message="([^"]*)"/g)].map(match => [match[1], match[2]]),
  ];
  for (const [id, message] of defaults) {
    if (englishMessages.has(id) && englishMessages.get(id) !== message) stale.push(`${file}: ${id}`);
  }
}
if (orphaned.length > 0) {
  throw new Error(`Message IDs used in source but missing from every catalog (add the folder to lingui.config.ts):\n${orphaned.join('\n')}`);
}
if (stale.length > 0) {
  throw new Error(`English catalog text differs from the source default; update the en and vi msgstr:\n${stale.join('\n')}`);
}
console.log(`Checked ${areas.length} catalogs: extraction is stable and en/vi message coverage is complete.`);
