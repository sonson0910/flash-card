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
  assert.match(source, /UPDATE_USER_SETTINGS/);
  assert.doesNotMatch(source, /writeUserSettings/);
  for (const id of ['selection-icon-site', 'add-selection-icon-site', 'selection-icon-sites']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(source, /permissions.*request|request.*permissions/s);
  assert.match(source, /permissions.*remove|remove.*permissions/s);
  assert.match(source, /selectionIconSitePatternFromUrl/);
});
