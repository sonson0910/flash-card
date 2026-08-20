import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';

export const DEFAULT_BUNDLE_BUDGETS = {
  initialJavaScriptRaw: 1_050_000,
  // Obsidian UI release baseline: 916,811 B raw / 283,772 B gzip JS and
  // 158,896 B raw / 22,847 B gzip CSS. Keep less than 5% initial headroom.
  initialJavaScriptGzip: 290_000,
  initialCssRaw: 165_000,
  initialCssGzip: 24_000,
  // Phase 0 baseline: 2,159,890 B raw / 633,879 B gzip.
  // These totals leave about 11% raw and 10% gzip headroom for reviewed growth.
  totalJavaScriptRaw: 2_400_000,
  totalJavaScriptGzip: 700_000,
  javaScriptChunkRaw: 650_000,
  javaScriptChunkGzip: 180_000,
};

export function parseInitialAssetPaths(html) {
  const assets = [];
  const seen = new Set();
  for (const match of html.matchAll(/(?:src|href)=["']\/?(assets\/[^"'?#]+\.(?:js|css))["']/g)) {
    if (!seen.has(match[1])) {
      seen.add(match[1]);
      assets.push(match[1]);
    }
  }
  return assets;
}

const byteSize = buffer => ({
  raw: buffer.byteLength,
  gzip: gzipSync(buffer, { level: 9 }).byteLength,
});

export function readBundleMetrics(distDirectory = path.resolve('dist')) {
  const indexPath = path.join(distDirectory, 'index.html');
  if (!fs.existsSync(indexPath)) {
    throw new Error('dist/index.html does not exist. Run the production build first.');
  }
  const initialPaths = parseInitialAssetPaths(fs.readFileSync(indexPath, 'utf8'));
  const initialJavaScript = { raw: 0, gzip: 0 };
  const initialCss = { raw: 0, gzip: 0 };
  for (const relativePath of initialPaths) {
    const sizes = byteSize(fs.readFileSync(path.join(distDirectory, relativePath)));
    const target = relativePath.endsWith('.js') ? initialJavaScript : initialCss;
    target.raw += sizes.raw;
    target.gzip += sizes.gzip;
  }
  const assetsDirectory = path.join(distDirectory, 'assets');
  const javaScriptChunks = fs.readdirSync(assetsDirectory)
    .filter(file => file.endsWith('.js'))
    .sort()
    .map(file => ({
      path: `assets/${file}`,
      ...byteSize(fs.readFileSync(path.join(assetsDirectory, file))),
    }));
  return { initialJavaScript, initialCss, javaScriptChunks };
}

const formatBytes = bytes => `${bytes.toLocaleString('en-US')} B`;

export function evaluateBundleBudget(metrics, budgets = DEFAULT_BUNDLE_BUDGETS) {
  const failures = [];
  const check = (label, actual, maximum) => {
    if (actual > maximum) {
      failures.push(`${label}: ${formatBytes(actual)} exceeds ${formatBytes(maximum)}`);
    }
  };
  check('initial JavaScript raw', metrics.initialJavaScript.raw, budgets.initialJavaScriptRaw);
  check('initial JavaScript gzip', metrics.initialJavaScript.gzip, budgets.initialJavaScriptGzip);
  check('initial CSS raw', metrics.initialCss.raw, budgets.initialCssRaw);
  check('initial CSS gzip', metrics.initialCss.gzip, budgets.initialCssGzip);
  const totalJavaScript = metrics.javaScriptChunks.reduce((total, chunk) => ({
    raw: total.raw + chunk.raw,
    gzip: total.gzip + chunk.gzip,
  }), { raw: 0, gzip: 0 });
  check('total JavaScript raw', totalJavaScript.raw, budgets.totalJavaScriptRaw);
  check('total JavaScript gzip', totalJavaScript.gzip, budgets.totalJavaScriptGzip);
  for (const chunk of metrics.javaScriptChunks) {
    check(`${chunk.path} raw`, chunk.raw, budgets.javaScriptChunkRaw);
    check(`${chunk.path} gzip`, chunk.gzip, budgets.javaScriptChunkGzip);
  }
  return failures;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const metrics = readBundleMetrics();
  const failures = evaluateBundleBudget(metrics);
  console.log(
    `Initial JavaScript: ${formatBytes(metrics.initialJavaScript.raw)} raw / `
    + `${formatBytes(metrics.initialJavaScript.gzip)} gzip`,
  );
  console.log(
    `Initial CSS: ${formatBytes(metrics.initialCss.raw)} raw / `
    + `${formatBytes(metrics.initialCss.gzip)} gzip`,
  );
  const totalJavaScript = metrics.javaScriptChunks.reduce((total, chunk) => ({
    raw: total.raw + chunk.raw,
    gzip: total.gzip + chunk.gzip,
  }), { raw: 0, gzip: 0 });
  console.log(
    `Total JavaScript: ${formatBytes(totalJavaScript.raw)} raw / `
    + `${formatBytes(totalJavaScript.gzip)} gzip`,
  );
  if (failures.length > 0) {
    throw new Error(`Bundle budget exceeded:\n- ${failures.join('\n- ')}`);
  }
  console.log(`Bundle budget passed for ${metrics.javaScriptChunks.length} JavaScript chunks.`);
}
