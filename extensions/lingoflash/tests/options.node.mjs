import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../options.html', import.meta.url), 'utf8');
const source = await readFile(new URL('../options.js', import.meta.url), 'utf8');

test('options page exposes the bounded settings controls and shared persistence', () => {
  for (const id of ['auto-speak', 'bubble-duration', 'recent-lookups-enabled', 'quick-translate-source', 'quick-translate-target']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /min="0"/);
  assert.match(html, /max="60000"/);
  assert.match(source, /readSettings/);
  assert.match(source, /writeSettings/);
});
