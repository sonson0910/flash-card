import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../options.html', import.meta.url), 'utf8');
const source = await readFile(new URL('../options.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../options.css', import.meta.url), 'utf8');

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

test('options follows the active course native language and only loads its settings after that resolves (07.5)', () => {
  assert.match(source, /applyCourseUiLocale/);
  assert.match(source, /const courseUiLocaleReady = applyCourseUiLocale\(\)/);
  assert.match(source, /courseUiLocaleReady\.then\(\(\) => load\(\)\)/);
});

test('options exposes pending feedback and explicit empty permission state without forcing a minimum width', () => {
  assert.match(html, /id="save-settings"/);
  assert.match(html, /id="selection-icon-empty"/);
  assert.match(source, /aria-busy/);
  assert.match(source, /Đang lưu/);
  assert.match(source, /selectionIconEmpty\.hidden/);
  assert.doesNotMatch(css, /min-width:\s*360px/);
});

test('options exposes a Classic/Crystal Star theme family choice that persists through the shared settings flow', () => {
  assert.match(html, /name="theme-family"[^>]*value="classic"/);
  assert.match(html, /name="theme-family"[^>]*value="crystal"/);
  assert.match(source, /themeFamilyInputs/);
  assert.match(source, /applyThemeFamily/);
  assert.match(source, /checkedThemeFamily/);
  assert.match(source, /themeFamily:\s*checkedThemeFamily/);
});

test('ports Crystal Star chamfered corners onto the card shell, inputs and buttons, but not the base rules', () => {
  assert.match(css, /:root\[data-theme-family="crystal"\] fieldset\s*\{[^}]*clip-path:\s*var\(--sf-chamfer\)/);
  assert.match(css, /:root\[data-theme-family="crystal"\][^{]*\.save-button[^{]*\{[^}]*clip-path:\s*var\(--sf-chamfer-sm\)/);
  assert.doesNotMatch(css, /^fieldset\s*\{[^}]*clip-path/m);
});
