#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const canvasDir = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(canvasDir, 'tokens.json');

async function evaluate(file, name) {
  const source = await readFile(resolve(canvasDir, 'src', file), 'utf8');
  return vm.runInNewContext(`${source}\n; ${name}`, {}, { filename: file });
}

function serializable(value, path = '$') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item, index) => serializable(item, `${path}[${index}]`));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, serializable(value[key], `${path}.${key}`)]));
  }
  throw new TypeError(`${path} is not JSON-serializable`);
}

const [sfTokens, nkTokens] = await Promise.all([
  evaluate('tokens.js', 'sfTokens'),
  evaluate('anime-tokens.js', 'nkTokens'),
]);
const tokens = serializable({
  'classic-dark': sfTokens(true),
  'classic-light': sfTokens(false),
  'crystal-dark': nkTokens(true),
  'crystal-light': nkTokens(false),
});
const contents = `${JSON.stringify(tokens, null, 2)}\n`;

if (process.argv.includes('--check')) {
  if (await readFile(outputPath, 'utf8') !== contents) {
    throw new Error('tokens.json does not match the evaluated canvas token sources; run generate-tokens.mjs');
  }
} else {
  await writeFile(outputPath, contents);
}
