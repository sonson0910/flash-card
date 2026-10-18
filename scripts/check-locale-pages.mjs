import fs from 'node:fs';
import path from 'node:path';
import { LOCALES, PRODUCTION_ORIGIN, readLocaleMetadata } from './generate-locale-pages.mjs';

const canonicalUrl = locale => `${PRODUCTION_ORIGIN}${locale.path ? `/${locale.path}/` : '/'}`;
const attribute = (tag, name) => new RegExp(`\\b${name}=["']([^"']*)["']`, 'i').exec(tag)?.[1];
const tags = (html, name) => html.match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) || [];
const escapeAttribute = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const escapeText = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const findMeta = (html, key, value) => tags(html, 'meta').find(tag => attribute(tag, key)?.toLowerCase() === value);

export const checkLocalePages = ({ root = path.resolve('.'), target = process.env.SONFLASH_TARGET?.trim() || 'production' } = {}) => {
  const dist = path.join(root, 'dist');
  const failures = [];
  for (const locale of LOCALES) {
    const file = path.join(dist, locale.path, 'index.html');
    if (!fs.existsSync(file)) { failures.push(`${locale.code}: missing ${path.relative(root, file)}`); continue; }
    const html = fs.readFileSync(file, 'utf8');
    const metadata = readLocaleMetadata(root, locale);
    const lang = /<html\b[^>]*\blang=["']([^"']+)["']/i.exec(html)?.[1];
    if (lang !== locale.lang) failures.push(`${locale.code}: expected html lang=${locale.lang}, got ${lang || 'missing'}`);

    // A production page must stay indexable; a non-production one (e.g. staging) must always
    // declare noindex so it never competes with the production canonical for the same content.
    const robotsMeta = attribute(findMeta(html, 'name', 'robots') || '', 'content')?.toLowerCase();
    if (target === 'production' && robotsMeta) failures.push(`${locale.code}: production build must not ship a noindex meta tag`);
    if (target !== 'production' && robotsMeta !== 'noindex, nofollow') failures.push(`${locale.code}: ${target} build is missing a noindex meta tag`);

    const links = tags(html, 'link');
    const canonical = links.find(tag => attribute(tag, 'rel')?.toLowerCase() === 'canonical');
    if (attribute(canonical || '', 'href') !== canonicalUrl(locale)) failures.push(`${locale.code}: self canonical is missing or incorrect`);

    const alternates = new Map(links
      .filter(tag => attribute(tag, 'rel')?.toLowerCase() === 'alternate')
      .map(tag => [attribute(tag, 'hreflang'), attribute(tag, 'href')]));
    for (const alternate of LOCALES) {
      if (alternates.get(alternate.lang) !== canonicalUrl(alternate)) failures.push(`${locale.code}: missing reciprocal hreflang for ${alternate.lang}`);
    }
    if (alternates.get('x-default') !== canonicalUrl(LOCALES[0])) failures.push(`${locale.code}: missing x-default hreflang`);

    if (!html.includes(`<title>${escapeText(metadata.title)}</title>`)) failures.push(`${locale.code}: localized title is missing or incorrect`);
    if (attribute(findMeta(html, 'name', 'description') || '', 'content') !== escapeAttribute(metadata.description)) failures.push(`${locale.code}: localized description is missing or incorrect`);
    if (attribute(findMeta(html, 'property', 'og:title') || '', 'content') !== escapeAttribute(metadata.title)) failures.push(`${locale.code}: og:title is missing or incorrect`);
    if (attribute(findMeta(html, 'property', 'og:description') || '', 'content') !== escapeAttribute(metadata.description)) failures.push(`${locale.code}: og:description is missing or incorrect`);
    if (attribute(findMeta(html, 'property', 'og:url') || '', 'content') !== canonicalUrl(locale)) failures.push(`${locale.code}: og:url is missing or incorrect`);
    if (attribute(findMeta(html, 'property', 'og:type') || '', 'content') !== 'website') failures.push(`${locale.code}: og:type is missing or incorrect`);
  }
  const sitemapFile = path.join(dist, 'sitemap.xml');
  if (!fs.existsSync(sitemapFile)) failures.push('sitemap.xml: missing');
  else {
    const sitemap = fs.readFileSync(sitemapFile, 'utf8');
    for (const locale of LOCALES) {
      const block = new RegExp(`<url>\\s*<loc>${canonicalUrl(locale)}</loc>([\\s\\S]*?)</url>`).exec(sitemap)?.[1];
      if (!block) { failures.push(`sitemap.xml: missing URL for ${locale.lang}`); continue; }
      for (const alternate of LOCALES) {
        if (!block.includes(`hreflang="${alternate.lang}" href="${canonicalUrl(alternate)}"`)) failures.push(`sitemap.xml: missing alternate ${alternate.lang} for ${locale.lang}`);
      }
      if (!block.includes(`hreflang="x-default" href="${canonicalUrl(LOCALES[0])}"`)) failures.push(`sitemap.xml: missing x-default for ${locale.lang}`);
    }
  }
  const robotsFile = path.join(dist, 'robots.txt');
  if (!fs.existsSync(robotsFile)) failures.push('robots.txt: missing');
  else {
    const robots = fs.readFileSync(robotsFile, 'utf8');
    if (target === 'production' && !/^Disallow:\s*$/im.test(robots) && !robots.includes('Allow: /')) failures.push('robots.txt: production build must allow crawling');
    if (target !== 'production' && !/^Disallow:\s*\/\s*$/im.test(robots)) failures.push(`robots.txt: ${target} build must disallow all crawling`);
  }
  if (failures.length) throw new Error(`Locale page validation failed:\n${failures.map(failure => `- ${failure}`).join('\n')}`);
  console.log(`Validated ${LOCALES.length} localized landing pages for target "${target}".`);
};

if (import.meta.url === `file://${process.argv[1]}`) checkLocalePages();
