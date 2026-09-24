import { createServer } from 'node:http';
import { readFile, readdir, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(root, 'reference');
const project = path.join(root, 'project');
const index = JSON.parse(await readFile(path.join(project, 'canvas.json'), 'utf8'));
const sources = new Set((await readdir(path.join(root, 'src')))
  .filter(name => name.endsWith('.dc.html')));
const references = index.order.flatMap(name => {
  const board = index.boards[name];
  if (!board) throw new Error(`Canvas index has no board: ${name}`);
  const base = name.slice(0, -'.dc.html'.length);
  return (sources.has(name) ? ['dark', 'light'] : ['comparison']).map(theme => ({
    name, theme, width: board.w, height: board.h,
    filename: `${base}-${theme}.png`,
  }));
});
const boardFilter = process.argv.find(argument => argument.startsWith('--board='))?.slice('--board='.length);
const selectedReferences = boardFilter
  ? references.filter(reference => reference.name === `${boardFilter}.dc.html`)
  : references;
if (!selectedReferences.length) throw new Error(`Unknown canvas board: ${boardFilter}`);

const isPng = async ({ filename, width, height }) => {
  try {
    const image = await readFile(path.join(output, filename));
    return image.length > 1024 && image.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      && image.readUInt32BE(16) === width && image.readUInt32BE(20) === height;
  } catch { return false; }
};

if (process.argv.includes('--check')) {
  const missing = [];
  for (const reference of selectedReferences) if (!await isPng(reference)) missing.push(reference.filename);
  if (missing.length) throw new Error(`${missing.length} missing or invalid PNGs: ${missing.slice(0, 12).join(', ')}`);
  console.log(`Verified ${selectedReferences.length} reference PNGs.`);
  process.exit(0);
}

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png' };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    const file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (!file.startsWith(`${root}${path.sep}`)) throw new Error('Outside canvas');
    await stat(file);
    let body = await readFile(file);
    const theme = url.searchParams.get('reference-theme');
    if (theme && sources.has(path.basename(file))) {
      const html = body.toString('utf8');
      const replaced = html.replace(/("theme":\{"editor":"enum","options":\["dark","light"\],"default":")(?:dark|light)(")/, `$1${theme}$2`);
      if (replaced === html && !html.includes(`"default":"${theme}"`)) throw new Error(`No theme prop: ${file}`);
      body = Buffer.from(replaced);
    }
    response.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end();
  }
});

await mkdir(output, { recursive: true });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ deviceScaleFactor: 1, reducedMotion: 'reduce' });
const failures = [];
try {
  for (const reference of selectedReferences) {
    if (!process.argv.includes('--force') && await isPng(reference)) continue;
    try {
      await page.setViewportSize({ width: reference.width, height: reference.height });
      const url = `http://127.0.0.1:${address.port}/project/${reference.name}`
        + (reference.theme === 'comparison' ? '' : `?reference-theme=${reference.theme}`);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.body.innerText.trim().length > 0, null, { timeout: 5000 });
      await page.screenshot({ path: path.join(output, reference.filename), animations: 'disabled' });
      if (!await isPng(reference)) throw new Error('PNG dimensions or signature mismatch');
    } catch (error) {
      failures.push(`${reference.filename}: ${error.message}`);
    }
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
if (failures.length) throw new Error(`${failures.length} renders failed:\n${failures.join('\n')}`);
console.log(`Rendered ${selectedReferences.length} reference PNGs.`);
