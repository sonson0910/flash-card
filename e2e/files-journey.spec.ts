import { expect, test, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

// The upload flow, My files and the card photo slot on a file service held in memory. The visual
// boards live in files-visual.spec.ts.
const FIXTURE_PORT_BASE = 5155;
let fixtureOrigin = `http://127.0.0.1:${FIXTURE_PORT_BASE}`;
let fixtureServer: ViteDevServer | undefined;

test.beforeAll(async ({}, testInfo) => {
  const port = FIXTURE_PORT_BASE + testInfo.parallelIndex;
  fixtureOrigin = `http://127.0.0.1:${port}`;
  fixtureServer = await createServer({
    configFile: 'vite.config.ts',
    cacheDir: `node_modules/.vite-e2e/files-journey-${testInfo.parallelIndex}`,
    appType: 'mpa',
    server: { host: '127.0.0.1', port, strictPort: true },
    optimizeDeps: { entries: ['e2e/fixtures/files-workspace.html'] },
  });
  await fixtureServer.listen();
});
test.afterAll(async () => { await fixtureServer?.close(); });

const KB = 1024;
const MB = 1024 * KB;
const pdf = (name: string, bytes: number) => ({
  name, mimeType: 'application/pdf', buffer: Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(Math.max(0, bytes - 9), 32)]),
});
// A 4 x 3 PNG the browser can decode and re-encode.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAFElEQVR4nGPUqDjBAANMDEgAhQMANAQBbjEPPlYAAAAASUVORK5CYII=', 'base64');

async function open(page: Page, query: string) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${fixtureOrigin}/e2e/fixtures/files-workspace.html?${query}`);
  await expect(page.locator('[data-files-fixture]')).toBeVisible({ timeout: 15_000 });
}

const usageText = (page: Page) => page.getByRole('meter', { name: 'Storage usage' }).first().getAttribute('aria-valuetext');
const chooser = (page: Page) => page.getByLabel('Choose a PDF, EPUB, or image');

test('uploads a PDF, attaches it to a course, deletes it and gives the storage back', async ({ page }) => {
  await open(page, 'surface=journey');
  const shelf = page.getByRole('complementary', { name: 'My files' });
  await expect(shelf.getByText('2 files')).toBeVisible();
  const before = await usageText(page);
  expect(before).toBe('1.3 MB of 8 MB used');

  await chooser(page).setInputFiles(pdf('reading-week-one.pdf', 600 * KB));
  await expect(page.getByRole('heading', { name: 'Ready to attach' })).toBeVisible();
  await expect(shelf.getByText('reading-week-one.pdf')).toBeVisible();
  await expect.poll(() => usageText(page)).toBe('1.9 MB of 8 MB used');

  await page.getByLabel('Attach to').selectOption({ label: 'General English' });
  await page.getByRole('button', { name: 'Attach source' }).click();
  await expect(page.getByText('Attached to General English.')).toBeVisible();
  await expect(shelf.getByText('PDF · General English · 600 KB')).toBeVisible();

  await shelf.getByRole('button', { name: 'Delete reading-week-one.pdf' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Delete this file?' });
  await expect(dialog.getByRole('button', { name: 'Keep file' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await shelf.getByRole('button', { name: 'Delete reading-week-one.pdf' }).click();
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(shelf.getByText('reading-week-one.pdf')).toBeHidden();
  await expect.poll(() => usageText(page)).toBe(before);
});

test('refuses a type outside the accepted list on the device', async ({ page }) => {
  await open(page, 'surface=journey');
  await chooser(page).setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('notes') });
  await expect(page.getByRole('alert')).toContainText('Type not supported');
  const chooserOpened = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose another', exact: true }).click();
  await chooserOpened;
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'Choose a file' })).toBeVisible();
});

test('cancels a transfer and releases the reservation', async ({ page }) => {
  await open(page, 'surface=journey&transfer=hold');
  await chooser(page).setInputFiles(pdf('reading-week-two.pdf', 500 * KB));
  await expect(page.getByRole('progressbar', { name: 'Upload progress' })).toHaveAttribute('aria-valuenow', '40');
  const reserved = page.locator('.sf-files-usage__grid div').filter({ hasText: 'Reserved' }).locator('dd');
  await expect(reserved).toHaveText('500 KB');
  await page.getByRole('button', { name: 'Cancel upload' }).click();
  await expect(page.getByRole('heading', { name: 'Upload canceled' })).toBeVisible();
  await expect(reserved).toHaveText('0 B');
  await expect(page.getByRole('button', { name: 'Retry upload' })).toBeVisible();
});

test('retries after a dropped connection and stores the file', async ({ page }) => {
  await open(page, 'surface=journey&transfer=drop-once');
  await chooser(page).setInputFiles(pdf('reading-week-three.pdf', 400 * KB));
  await expect(page.getByRole('heading', { name: 'Try the upload again' })).toBeVisible();
  await page.getByRole('button', { name: 'Retry upload' }).click();
  await expect(page.getByRole('heading', { name: 'Ready to attach' })).toBeVisible();
});

test('states the storage limit and what to do when the allowance is used up', async ({ page }) => {
  await open(page, 'surface=journey&limit=tight');
  await chooser(page).setInputFiles(pdf('practice-tests.pdf', 3 * MB));
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Your storage is full');
  await expect(alert).toContainText('This file needs 3 MB, and 2.7 MB of your 4 MB is free.');
  await expect(page.locator('.sf-files')).not.toContainText(/compare plan|upgrade|pricing|checkout/i);
  await page.getByRole('button', { name: 'Manage files' }).click();
  await expect(page.getByRole('heading', { name: 'My files' })).toBeFocused();
});

test('shows usage in settings and opens My files', async ({ page }) => {
  await open(page, 'surface=settings');
  await expect(page.getByRole('heading', { name: 'Storage and files' })).toBeVisible();
  await expect(page.getByText('3 files · 3.7 MB of 8 MB used')).toBeVisible();
  await page.getByRole('button', { name: 'Open My files' }).click();
  await expect(page.locator('[data-files-opened]')).toHaveText('1');
  await open(page, 'surface=settings&state=error');
  await expect(page.getByRole('alert')).toHaveText('Storage usage could not load.');
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
});

test('uploads a photo into the card editor and shows it on the draft', async ({ page }) => {
  await open(page, 'surface=card-edit');
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Upload a photo', { exact: true }).setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: png });
  await expect(sheet.locator('img.edit-sheet-image-thumb')).toHaveAttribute('src', /^blob:/);
  await expect(sheet.getByRole('button', { name: 'Remove image' })).toBeVisible();
});

test('explains a full allowance in the card editor', async ({ page }) => {
  await open(page, 'surface=card-edit&limit=tight');
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Upload a photo', { exact: true }).setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: png });
  await expect(sheet.getByRole('alert')).toContainText('Your storage is full.');
});
