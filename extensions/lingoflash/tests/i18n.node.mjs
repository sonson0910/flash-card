import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { loadMessages, resolveMessage } from './i18n-test-helper.mjs';

const vi = loadMessages('vi');
const en = loadMessages('en');
const manifest = JSON.parse(
  await readFile(new URL('../manifest.json', import.meta.url), 'utf8'),
);

test('en and vi message catalogs declare the exact same key set', () => {
  const viKeys = Object.keys(vi).sort();
  const enKeys = Object.keys(en).sort();
  assert.deepEqual(enKeys, viKeys);
  assert.ok(viKeys.length > 0);
});

test('every message value is non-empty text in both locales', () => {
  for (const [locale, catalog] of [['vi', vi], ['en', en]]) {
    for (const [key, entry] of Object.entries(catalog)) {
      assert.equal(typeof entry.message, 'string', `${locale}.${key} must be a string message`);
      assert.ok(entry.message.trim().length > 0, `${locale}.${key} must not be empty`);
    }
  }
});

test('placeholders referenced in a message are declared with a positional content ref', () => {
  for (const [locale, catalog] of [['vi', vi], ['en', en]]) {
    for (const [key, entry] of Object.entries(catalog)) {
      const referenced = [...entry.message.matchAll(/\$([A-Z][A-Z0-9_]*)\$/g)].map(match => match[1].toLowerCase());
      for (const name of referenced) {
        const placeholder = entry.placeholders?.[name];
        assert.ok(placeholder, `${locale}.${key} references $${name.toUpperCase()}$ without declaring it`);
        assert.match(String(placeholder.content ?? ''), /^\$\d$/, `${locale}.${key}.${name} content must be a positional reference`);
      }
    }
  }
});

test('resolves positional substitutions the same way Chrome does', () => {
  assert.equal(resolveMessage(vi, 'resultSpeakAriaLabel', ['bonjour']), 'Nghe phát âm bonjour');
  assert.equal(resolveMessage(en, 'resultSpeakAriaLabel', ['bonjour']), 'Pronounce bonjour');
  assert.equal(resolveMessage(vi, 'statusCreatedSaved', ['immediate', '']), 'Đã tạo và lưu “immediate”.');
  assert.equal(resolveMessage(vi, 'dueCountBadge', [12]), '12 thẻ đến hạn');
  assert.equal(resolveMessage(vi, 'missingKey'), '');
});

test('manifest keeps the SonFlash brand within the Chrome Web Store field limits', () => {
  assert.equal(manifest.default_locale, 'vi');
  for (const [field, limit] of [['name', 75], ['short_name', 12], ['description', 132]]) {
    assert.ok(typeof manifest[field] === 'string' && manifest[field].length <= limit, `${field} must be at most ${limit} characters`);
    assert.match(manifest[field], /SonFlash/);
  }
});
