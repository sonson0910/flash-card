import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'vitest';
import { checkLocalePages } from './check-locale-pages.mjs';
import { PRODUCTION_ORIGIN, generateLocalePages } from './generate-locale-pages.mjs';

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

describe('public origin', () => {
  const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

  it('is the Hosting origin the deployed app and the reminder links use', () => {
    const config = JSON.parse(read('firebase-applet-config.json'));
    const hosts = JSON.stringify(config);
    assert.ok(hosts.includes(new URL(PRODUCTION_ORIGIN).host), 'firebase-applet-config.json must allow the public origin host');
    assert.ok(read('functions/src/reminderAppOrigin.ts').includes(`'${PRODUCTION_ORIGIN}'`), 'reminder links must use the public origin');
  });

  it('is the only host named by canonical, hreflang, Open Graph, sitemap and robots output', () => {
    const root = createFixture();
    generateLocalePages({ root });
    const output = ['index.html', 'vi/index.html', 'sitemap.xml', 'robots.txt']
      .map(file => fs.readFileSync(path.join(root, 'dist', file), 'utf8')).join('\n');
    const origins = new Set(output.match(/https?:\/\/[^/"<\s]+/g));
    assert.deepEqual([...origins].filter(origin => origin !== PRODUCTION_ORIGIN && !origin.startsWith('http://www.sitemaps.org') && !origin.startsWith('http://www.w3.org')), []);
    assert.ok(output.includes(`Sitemap: ${PRODUCTION_ORIGIN}/sitemap.xml`));
  });

  it('is the host the checked-in robots.txt names, so the dev server and the build agree', () => {
    assert.equal(read('public/robots.txt').match(/^Sitemap: (https?:\/\/[^/\s]+)\//m)?.[1], PRODUCTION_ORIGIN);
  });

  it('is rejected by the page check when robots.txt names another host', () => {
    const root = createFixture();
    generateLocalePages({ root });
    const robots = path.join(root, 'dist/robots.txt');
    fs.writeFileSync(robots, fs.readFileSync(robots, 'utf8').replace(PRODUCTION_ORIGIN, 'https://example.com'));
    assert.throws(() => checkLocalePages({ root }), /robots\.txt: sitemap must be/);
  });
});

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
    assert.match(fs.readFileSync(path.join(root, 'dist/sitemap.xml'), 'utf8'), new RegExp(`${PRODUCTION_ORIGIN.replaceAll('.', '\\.')}/vi/`));
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
      .replace(`${PRODUCTION_ORIGIN}/vi/`, 'https://example.com/vi/')
      .replace('<html lang="vi">', '<html lang="en">'));
    assert.throws(() => checkLocalePages({ root }), /expected html lang=vi/);
    assert.throws(() => checkLocalePages({ root }), /self canonical is missing or incorrect/);
  });

  it('rejects malformed sitemap alternates', () => {
    const root = createFixture();
    generateLocalePages({ root });
    const sitemap = path.join(root, 'dist/sitemap.xml');
    fs.writeFileSync(sitemap, fs.readFileSync(sitemap, 'utf8').replace(`hreflang="vi" href="${PRODUCTION_ORIGIN}/vi/"`, 'hreflang="vi" href="https://example.com/vi/"'));
    assert.throws(() => checkLocalePages({ root }), /sitemap\.xml: missing alternate vi for en/);
  });

  it('marks a staging build noindex on every locale page and disallows all crawling', () => {
    const root = createFixture();
    generateLocalePages({ root, target: 'staging' });
    const english = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8');
    const vietnamese = fs.readFileSync(path.join(root, 'dist/vi/index.html'), 'utf8');
    assert.match(english, /<meta name="robots" content="noindex, nofollow" \/>/);
    assert.match(vietnamese, /<meta name="robots" content="noindex, nofollow" \/>/);
    assert.match(fs.readFileSync(path.join(root, 'dist/robots.txt'), 'utf8'), /^Disallow: \/$/m);
    checkLocalePages({ root, target: 'staging' });
  });

  it('ships a crawl-blocking robots file that a staging Hosting promotion can serve for any target', () => {
    for (const target of ['production', 'staging']) {
      const root = createFixture();
      generateLocalePages({ root, target });
      assert.equal(fs.readFileSync(path.join(root, 'dist/robots-disallow.txt'), 'utf8'), 'User-agent: *\nDisallow: /\n');
      checkLocalePages({ root, target });
      fs.writeFileSync(path.join(root, 'dist/robots-disallow.txt'), 'User-agent: *\nAllow: /\n');
      assert.throws(() => checkLocalePages({ root, target }), /robots-disallow\.txt/);
    }
  });

  it('rejects a production build that ships a noindex meta tag', () => {
    const root = createFixture();
    generateLocalePages({ root });
    const english = path.join(root, 'dist/index.html');
    fs.writeFileSync(english, fs.readFileSync(english, 'utf8').replace('</head>', '<meta name="robots" content="noindex, nofollow" /></head>'));
    assert.throws(() => checkLocalePages({ root }), /production build must not ship a noindex meta tag/);
  });

  it('rejects a staging build missing the noindex meta tag or the crawl block', () => {
    const root = createFixture();
    generateLocalePages({ root, target: 'staging' });
    const english = path.join(root, 'dist/index.html');
    fs.writeFileSync(english, fs.readFileSync(english, 'utf8').replace('<meta name="robots" content="noindex, nofollow" />', ''));
    assert.throws(() => checkLocalePages({ root, target: 'staging' }), /missing a noindex meta tag/);

    const restaged = createFixture();
    generateLocalePages({ root: restaged, target: 'staging' });
    fs.writeFileSync(path.join(restaged, 'dist/robots.txt'), 'User-agent: *\nAllow: /\n');
    assert.throws(() => checkLocalePages({ root: restaged, target: 'staging' }), /must disallow all crawling/);
  });

  it('runs the generator and the checker from a path with spaces, non-ASCII characters and a symlink', () => {
    const fixture = createFixture();
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sonflash entry guard \u0111\u01b0\u1eddng d\u1eabn-'));
    roots.push(base);
    const checkout = path.join(base, 'real checkout \u0111');
    fs.mkdirSync(path.join(checkout, 'scripts'), { recursive: true });
    for (const name of ['generate-locale-pages.mjs', 'check-locale-pages.mjs']) {
      fs.copyFileSync(new URL(`./${name}`, import.meta.url), path.join(checkout, 'scripts', name));
    }
    fs.cpSync(path.join(fixture, 'src'), path.join(checkout, 'src'), { recursive: true });
    fs.cpSync(path.join(fixture, 'dist'), path.join(checkout, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(checkout, 'dist/robots.txt'), 'User-agent: *\nAllow: /\n');
    const linked = path.join(base, 'linked checkout');
    fs.symlinkSync(checkout, linked);
    const run = script => execFileSync(process.execPath, [path.join(linked, 'scripts', script)], {
      cwd: linked,
      encoding: 'utf8',
      env: { ...process.env, SONFLASH_TARGET: 'staging' },
    });

    assert.match(run('generate-locale-pages.mjs'), /Generated 2 localized landing pages/);
    assert.match(fs.readFileSync(path.join(checkout, 'dist/robots.txt'), 'utf8'), /^Disallow: \/$/m);
    assert.ok(fs.existsSync(path.join(checkout, 'dist/vi/index.html')));
    assert.match(run('check-locale-pages.mjs'), /Validated 2 localized landing pages/);

    fs.writeFileSync(path.join(checkout, 'dist/robots.txt'), 'User-agent: *\nAllow: /\n');
    assert.throws(() => run('check-locale-pages.mjs'), /must disallow all crawling/);
  });
});
