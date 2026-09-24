import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'vitest';
import { checkLocalePages } from './check-locale-pages.mjs';
import { generateLocalePages } from './generate-locale-pages.mjs';

const roots = [];
const createFixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sonflash-locale-pages-'));
  roots.push(root);
  for (const [locale, title, description] of [
    ['en', 'Remember English & SonFlash', 'Build English vocabulary with active recall.'],
    ['vi', 'Nhớ từ tiếng Anh cùng SonFlash', 'Xây dựng vốn từ tiếng Anh bằng phương pháp chủ động nhớ lại.'],
  ]) {
    const directory = path.join(root, 'src/i18n/locales', locale);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'landing.po'), `msgid "landing.meta.title"\nmsgstr "${title}"\n\nmsgid "landing.meta.description"\nmsgstr "${description}"\n`);
  }
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist/index.html'), '<!doctype html><html lang="en"><head><meta name="description" content="old" /><script>const boot = true;</script><title>Old</title></head><body></body></html>');
  return root;
};

afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));

describe('localized landing pages', () => {
  it('generates catalog-owned metadata without changing the inline boot script', () => {
    const root = createFixture();
    generateLocalePages({ root });
    const english = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8');
    const vietnamese = fs.readFileSync(path.join(root, 'dist/vi/index.html'), 'utf8');
    assert.match(english, /<title>Remember English &amp; SonFlash<\/title>/);
    assert.match(vietnamese, /<title>Nhớ từ tiếng Anh cùng SonFlash<\/title>/);
    assert.match(vietnamese, /<html lang="vi">/);
    assert.match(vietnamese, /<script>const boot = true;<\/script>/);
    assert.match(fs.readFileSync(path.join(root, 'dist/sitemap.xml'), 'utf8'), /https:\/\/sonflash\.app\/vi\//);
    checkLocalePages({ root });
  });

  it('rejects a page missing reciprocal hreflang', () => {
    const root = createFixture();
    generateLocalePages({ root });
    const vietnamese = path.join(root, 'dist/vi/index.html');
    fs.writeFileSync(vietnamese, fs.readFileSync(vietnamese, 'utf8').replace(/\s*<link rel="alternate" hreflang="en"[^>]*>/, ''));
    assert.throws(() => checkLocalePages({ root }), /missing reciprocal hreflang for en/);
  });

  it('rejects incorrect canonical URLs and document languages', () => {
    const root = createFixture();
    generateLocalePages({ root });
    const vietnamese = path.join(root, 'dist/vi/index.html');
    fs.writeFileSync(vietnamese, fs.readFileSync(vietnamese, 'utf8')
      .replace('https://sonflash.app/vi/', 'https://example.com/vi/')
      .replace('<html lang="vi">', '<html lang="en">'));
    assert.throws(() => checkLocalePages({ root }), /expected html lang=vi/);
    assert.throws(() => checkLocalePages({ root }), /self canonical is missing or incorrect/);
  });

  it('rejects malformed sitemap alternates', () => {
    const root = createFixture();
    generateLocalePages({ root });
    const sitemap = path.join(root, 'dist/sitemap.xml');
    fs.writeFileSync(sitemap, fs.readFileSync(sitemap, 'utf8').replace('hreflang="vi" href="https://sonflash.app/vi/"', 'hreflang="vi" href="https://example.com/vi/"'));
    assert.throws(() => checkLocalePages({ root }), /sitemap\.xml: missing alternate vi for en/);
  });
});
