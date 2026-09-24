import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

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

const parseCatalog = (source) => {
  const messages = new Map();
  let id = '';
  let translation = '';
  let field = null;
  const save = () => { if (id) messages.set(id, translation); id = ''; translation = ''; field = null; };
  for (const line of source.split(/\r?\n/)) {
    if (!line) { save(); continue; }
    if (line.startsWith('msgid ')) { id = JSON.parse(line.slice(6)); field = 'id'; }
    else if (line.startsWith('msgstr ')) { translation = JSON.parse(line.slice(7)); field = 'translation'; }
    else if (line.startsWith('"') && field === 'id') id += JSON.parse(line);
    else if (line.startsWith('"') && field === 'translation') translation += JSON.parse(line);
  }
  save();
  return messages;
};

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
console.log(`Checked ${areas.length} catalogs: extraction is stable and en/vi message coverage is complete.`);
