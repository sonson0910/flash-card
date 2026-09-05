import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';

export const DEFAULT_BUNDLE_BUDGETS = {
  // Optimized baseline: 204,028 B raw / 64,716 B gzip JS. Keep about 10%
  // initial headroom.
  initialJavaScriptRaw: 224_000,
  initialJavaScriptGzip: 71_000,
  // Refreshed learning UI baseline: 196,193 B raw / 28,008 B gzip. Keep
  // about 5% reviewed headroom.
  initialCssRaw: 206_000,
  initialCssGzip: 29_500,
  // The isolated bounded spreadsheet worker intentionally duplicates parser
  // code. Release C adaptive Today measures 2.745 MB raw / 868 KB gzip;
  // keep small rounded release headroom without weakening per-chunk gates.
  totalJavaScriptRaw: 2_760_000,
  totalJavaScriptGzip: 880_000,
  javaScriptChunkRaw: 650_000,
  javaScriptChunkGzip: 180_000,
  // Reviewed media baseline: 19,186,502 B raw, including the three
  // audio-first Listen MVP clips. Keep small rounded release headroom.
  totalMediaRaw: 20_000_000,
};

const IMAGE_ASSET_PATTERN = /\.(?:avif|gif|jpe?g|png|svg|webp)$/i;
const VIDEO_ASSET_PATTERN = /\.(?:m4v|mov|mp4|ogv|webm)$/i;
const AUDIO_ASSET_PATTERN = /\.(?:aac|flac|m4a|mp3|oga|ogg|opus|wav)$/i;

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

const readRecursiveAssets = (directory, pattern, rootDirectory) => {
  if (!fs.existsSync(directory)) return [];
  const assets = [];
  const visit = currentDirectory => {
    for (const entry of fs.readdirSync(currentDirectory, { withFileTypes: true })) {
      const filePath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        visit(filePath);
      } else if (entry.isFile() && pattern.test(entry.name)) {
        assets.push({
          path: path.relative(rootDirectory, filePath).split(path.sep).join('/'),
          ...byteSize(fs.readFileSync(filePath)),
        });
      }
    }
  };
  visit(directory);
  return assets.sort((left, right) => left.path.localeCompare(right.path));
};

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
  const imageAssets = fs
    .readdirSync(assetsDirectory)
    .filter(file => IMAGE_ASSET_PATTERN.test(file))
    .sort()
    .map(file => ({
      path: `assets/${file}`,
      ...byteSize(fs.readFileSync(path.join(assetsDirectory, file))),
    }));
  const videoAssets = fs
    .readdirSync(assetsDirectory)
    .filter(file => VIDEO_ASSET_PATTERN.test(file))
    .sort()
    .map(file => ({
      path: `assets/${file}`,
      ...byteSize(fs.readFileSync(path.join(assetsDirectory, file))),
    }));
  const audioAssets = readRecursiveAssets(path.join(distDirectory, 'media'), AUDIO_ASSET_PATTERN, distDirectory);
  const totalMediaRaw = [...imageAssets, ...videoAssets, ...audioAssets].reduce(
    (total, asset) => total + asset.raw,
    0,
  );
  return {
    initialAssetPaths: initialPaths,
    initialJavaScript,
    initialCss,
    javaScriptChunks,
    imageAssets,
    videoAssets,
    audioAssets,
    totalMediaRaw,
  };
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
  const imageAssets = metrics.imageAssets ?? [];
  const videoAssets = metrics.videoAssets ?? [];
  const audioAssets = metrics.audioAssets ?? [];
  const totalMediaRaw = imageAssets.length > 0 || videoAssets.length > 0 || audioAssets.length > 0
    ? [...imageAssets, ...videoAssets, ...audioAssets].reduce((total, asset) => total + asset.raw, 0)
    : metrics.totalMediaRaw ?? 0;
  check('total media raw', totalMediaRaw, budgets.totalMediaRaw);
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
  const audioAssets = metrics.audioAssets ?? [];
  const totalMediaRaw = metrics.totalMediaRaw ?? [
    ...(metrics.imageAssets ?? []), ...(metrics.videoAssets ?? []), ...audioAssets,
  ]
    .reduce((total, asset) => total + asset.raw, 0);
  const audioRaw = audioAssets.reduce((total, asset) => total + asset.raw, 0);
  console.log(
    `Total media: ${formatBytes(totalMediaRaw)} raw `
      + `(${formatBytes((metrics.imageAssets ?? []).reduce((total, asset) => total + asset.raw, 0))} image / `
      + `${formatBytes((metrics.videoAssets ?? []).reduce((total, asset) => total + asset.raw, 0))} video / `
      + `${formatBytes(audioRaw)} audio)`,
  );
  if (failures.length > 0) {
    throw new Error(`Bundle budget exceeded:\n- ${failures.join('\n- ')}`);
  }
  console.log(`Bundle budget passed for ${metrics.javaScriptChunks.length} JavaScript chunks.`);
}
