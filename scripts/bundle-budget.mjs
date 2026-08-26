import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';

export const DEFAULT_BUNDLE_BUDGETS = {
  // Optimized baseline: 204,028 B raw / 64,716 B gzip JS. Keep about 10%
  // initial headroom.
  initialJavaScriptRaw: 224_000,
  initialJavaScriptGzip: 71_000,
  initialCssRaw: 183_000,
  initialCssGzip: 26_500,
  // The isolated bounded spreadsheet worker intentionally duplicates parser
  // code: 2,422,586 B raw / 776,120 B gzip. Keep about 10% reviewed headroom.
  totalJavaScriptRaw: 2_700_000,
  totalJavaScriptGzip: 860_000,
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
  return { initialAssetPaths: initialPaths, initialJavaScript, initialCss, javaScriptChunks };
}

const formatBytes = bytes => `${bytes.toLocaleString('en-US')} B`;

export function evaluateBundleBudget(metrics, budgets = DEFAULT_BUNDLE_BUDGETS) {
  const failures = [];
  const check = (label, actual, maximum) => {
    if (actual > maximum) {
      failures.push(`${label}: ${formatBytes(actual)} exceeds ${formatBytes(maximum)}`);
    }
  };
  for (const initialPath of metrics.initialAssetPaths ?? []) {
    if (/firebase/i.test(initialPath)) {
      failures.push(`initial asset graph contains deferred cloud chunk: ${initialPath}`);
    }
  }
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
