import fs from 'node:fs';
import path from 'node:path';

export const PRODUCTION_ORIGIN = 'https://sonflash.app';
export const LOCALES = [
  { code: 'en', path: '', lang: 'en' },
  { code: 'vi', path: 'vi', lang: 'vi' },
];

const readCatalog = file => {
  const messages = new Map();
  let id = '';
  let translation = '';
  let field = null;
  const save = () => {
    if (id) messages.set(id, translation);
    id = '';
    translation = '';
    field = null;
  };

  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line) { save(); continue; }
    if (line.startsWith('msgid ')) { id = JSON.parse(line.slice(6)); field = 'id'; }
    else if (line.startsWith('msgstr ')) { translation = JSON.parse(line.slice(7)); field = 'translation'; }
    else if (line.startsWith('"') && field === 'id') id += JSON.parse(line);
    else if (line.startsWith('"') && field === 'translation') translation += JSON.parse(line);
  }
  save();
  return messages;
};

export const readLocaleMetadata = (root, locale) => {
  const catalog = readCatalog(path.join(root, 'src/i18n/locales', locale.code, 'landing.po'));
  const title = catalog.get('landing.meta.title');
  const description = catalog.get('landing.meta.description');
  if (!title || !description) {
    throw new Error(`${locale.code} landing catalog must provide landing.meta.title and landing.meta.description.`);
  }
  return { title, description };
};

const escapeAttribute = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const escapeText = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const canonicalUrl = locale => `${PRODUCTION_ORIGIN}${locale.path ? `/${locale.path}/` : '/'}`;
const alternateLinks = () => [
  ...LOCALES.map(locale => `<link rel="alternate" hreflang="${locale.lang}" href="${canonicalUrl(locale)}" />`),
  `<link rel="alternate" hreflang="x-default" href="${canonicalUrl(LOCALES[0])}" />`,
].join('\n    ');

const replaceHeadMetadata = (html, locale, metadata, target) => {
  const canonical = canonicalUrl(locale);
  const tags = [
    `<meta name="description" content="${escapeAttribute(metadata.description)}" />`,
    // A staging deploy (`SONFLASH_TARGET=staging`, a separate Firebase project) must never
    // compete with the production canonical for the same content — `robots.txt` alone only
    // blocks crawling, not indexing of an already-linked URL, so staging also gets an explicit
    // noindex directive here.
    ...(target !== 'production' ? ['<meta name="robots" content="noindex, nofollow" />'] : []),
    `<link rel="canonical" href="${canonical}" />`,
    alternateLinks(),
    '<meta property="og:type" content="website" />',
    `<meta property="og:title" content="${escapeAttribute(metadata.title)}" />`,
    `<meta property="og:description" content="${escapeAttribute(metadata.description)}" />`,
    `<meta property="og:url" content="${canonical}" />`,
    `<title>${escapeText(metadata.title)}</title>`,
  ].join('\n    ');
  const withoutExistingSeo = html
    .replace(/\s*<title>[\s\S]*?<\/title>/i, '')
    .replace(/\s*<meta\s+name=["']description["'][^>]*>/i, '')
    .replace(/\s*<meta\s+name=["']robots["'][^>]*>/i, '')
    .replace(/\s*<(?:meta|link)\b[^>]*(?:rel=["']canonical["']|rel=["']alternate["']|property=["']og:[^"']+["'])[^>]*>/gi, '');
  if (!/<html\b[^>]*\blang=["'][^"']*["']/i.test(withoutExistingSeo)) throw new Error('Built index.html is missing an html lang attribute.');
  const localized = withoutExistingSeo.replace(/<html\b([^>]*)\blang=["'][^"']*["']([^>]*)>/i, `<html$1lang="${locale.lang}"$2>`);
  if (!localized.includes('</head>')) throw new Error('Built index.html is missing a closing head tag.');
  return localized.replace('</head>', `    ${tags}\n  </head>`);
};

const sitemap = () => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${LOCALES.map(locale => `  <url>\n    <loc>${canonicalUrl(locale)}</loc>\n${LOCALES.map(alternate => `    <xhtml:link rel="alternate" hreflang="${alternate.lang}" href="${canonicalUrl(alternate)}" />`).join('\n')}\n    <xhtml:link rel="alternate" hreflang="x-default" href="${canonicalUrl(LOCALES[0])}" />\n  </url>`).join('\n')}\n</urlset>\n`;

// A non-production target (currently only `staging`, a separate Firebase project used for
// pre-release verification) ships the same markup as production and must never be crawled or
// indexed under its own domain — that would create duplicate-content and could leak an
// unreleased build ahead of launch. `Disallow: /` (crawling) and each page's `noindex` meta
// (indexing of URLs discovered another way, e.g. a shared staging link) cover both vectors.
const robotsTxt = target => target === 'production'
  ? `User-agent: *\nAllow: /\nSitemap: ${PRODUCTION_ORIGIN}/sitemap.xml\n`
  : 'User-agent: *\nDisallow: /\n';

export const generateLocalePages = ({ root = path.resolve('.'), target = process.env.SONFLASH_TARGET?.trim() || 'production' } = {}) => {
  const dist = path.join(root, process.env.SONFLASH_BUILD_OUT_DIR || 'dist');
  const basePath = path.join(dist, 'index.html');
  const baseHtml = fs.readFileSync(basePath, 'utf8');
  for (const locale of LOCALES) {
    const output = locale.path ? path.join(dist, locale.path, 'index.html') : basePath;
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, replaceHeadMetadata(baseHtml, locale, readLocaleMetadata(root, locale), target), 'utf8');
  }
  fs.writeFileSync(path.join(dist, 'sitemap.xml'), sitemap(), 'utf8');
  fs.writeFileSync(path.join(dist, 'robots.txt'), robotsTxt(target), 'utf8');
  console.log(`Generated ${LOCALES.length} localized landing pages, sitemap.xml, and robots.txt for target "${target}".`);
};

if (import.meta.url === `file://${process.argv[1]}`) generateLocalePages();
