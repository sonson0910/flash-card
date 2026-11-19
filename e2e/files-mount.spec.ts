import { expect, test, type Page } from './fixtures/firebase-emulator';

// My files in the signed-in app, against the Auth, Firestore, Functions and Storage emulators.
// The upload states themselves are covered on a file service held in memory in files-journey.spec.ts.
const STORAGE_EMULATOR_PORT = 9199;

// A 4 x 3 PNG the browser can decode and re-encode.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAFElEQVR4nGPUqDjBAANMDEgAhQMANAQBbjEPPlYAAAAASUVORK5CYII=', 'base64');

/** Counts the file listings the page asks the service for. */
function countListings(page: Page) {
  const listings = { count: 0 };
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/listMyFiles')) listings.count += 1;
  });
  return listings;
}

const usage = (page: Page) => page.getByRole('meter', { name: 'Storage usage' });
const onFiles = (url: URL) => url.searchParams.get('view') === 'files';
const onStorageSettings = (url: URL) => url.searchParams.get('view') === 'settings' && url.searchParams.get('section') === 'files';

test('opens My files from the storage settings section and goes back with the browser', async ({ page, seedCourseProfile, signIn, blockExternalNetwork }) => {
  await seedCourseProfile({ targetLanguage: 'ko' });
  await blockExternalNetwork(page);
  const listings = countListings(page);
  await signIn(page, '/?view=settings&locale=en');

  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Storage & files' }).click();
  await expect(page).toHaveURL(onStorageSettings);
  await expect(page.getByRole('heading', { level: 1, name: 'Storage & files' })).toBeVisible();
  const storage = page.getByRole('region', { name: 'Storage and files' });
  await expect(storage.getByText('0 files · 0 B of 100 MB used')).toBeVisible();
  await expect(storage.getByRole('meter', { name: 'Storage usage' })).toHaveAttribute('aria-valuetext', '0 B of 100 MB used');
  expect(listings.count).toBe(1);

  await storage.getByRole('button', { name: 'Open My files' }).click();
  await expect(page).toHaveURL(onFiles);
  await expect(page.getByRole('heading', { level: 1, name: 'Bring in a source.' })).toBeFocused();
  const shelf = page.getByRole('complementary', { name: 'My files' });
  await expect(shelf.getByText('No files yet')).toBeVisible();
  await expect(shelf.getByText('0 files', { exact: true })).toBeVisible();
  await expect(usage(page).first()).toHaveAttribute('aria-valuetext', '0 B of 100 MB used');
  await expect(page.getByRole('heading', { name: 'Choose a file' })).toBeVisible();
  // The desktop bar or, on phones, the floating bar marks Vocabulary as the current place.
  const current = page.locator('nav [aria-current="page"]').filter({ visible: true });
  await expect(current).toHaveCount(1);
  await expect(current).toContainText('Vocabulary');
  expect(listings.count).toBe(2);

  await page.goBack();
  await expect(page).toHaveURL(onStorageSettings);
  await expect(page.getByRole('region', { name: 'Storage and files' }).getByText('0 files · 0 B of 100 MB used')).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('complementary', { name: 'My files' }).getByText('No files yet')).toBeVisible();
});

test('uploads a photo to the Storage emulator and keeps it on the shelf', async ({ page, db, testUser, seedCourseProfile, signIn, blockExternalNetwork }) => {
  test.setTimeout(90_000);
  await seedCourseProfile({ targetLanguage: 'ko' });
  await blockExternalNetwork(page, [STORAGE_EMULATOR_PORT]);
  await signIn(page, '/?view=files&locale=en');
  const shelf = page.getByRole('complementary', { name: 'My files' });
  await expect(shelf.getByText('No files yet')).toBeVisible();

  await page.getByLabel('Choose a PDF, EPUB, or image').setInputFiles({ name: 'hangul-chart.png', mimeType: 'image/png', buffer: png });
  // The finalize trigger settles the upload from the stored object; the page waits for its verdict.
  await expect(page.getByRole('heading', { name: 'Ready to attach' })).toBeVisible({ timeout: 45_000 });
  await expect(shelf.getByText('1 file', { exact: true })).toBeVisible();

  // The browser re-encodes the photo: WebP where it can, JPEG otherwise.
  const stored = await db.collection('users').doc(testUser.uid).collection('files').get();
  expect(stored.docs).toHaveLength(1);
  const record = stored.docs[0]!.data();
  expect(record).toMatchObject({ status: 'ready', verification: 'complete', purpose: 'source' });
  expect(`${record.name} ${record.contentType}`).toMatch(/^hangul-chart\.webp image\/webp$|^hangul-chart\.jpg image\/jpeg$/);
  await expect(shelf.getByText(record.name as string)).toBeVisible();
  // A 4 x 3 photo stays well under a kilobyte, so the meter shows whole bytes.
  expect(record.bytes).toBeGreaterThan(0);
  expect(record.bytes).toBeLessThan(1024);
  await expect(usage(page).first()).toHaveAttribute('aria-valuetext', `${record.bytes} B of 100 MB used`);

  await page.reload();
  await expect(page.getByRole('complementary', { name: 'My files' }).getByText(record.name as string)).toBeVisible();
});
