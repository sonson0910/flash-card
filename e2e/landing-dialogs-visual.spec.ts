import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures/firebase-emulator';
import type { Locator, Page, TestInfo } from '@playwright/test';

const fixedTime = new Date('2026-09-27T12:00:00.000Z');
const themes = [
  { family: 'classic', mode: 'light' },
  { family: 'classic', mode: 'dark' },
  { family: 'crystal', mode: 'light' },
  { family: 'crystal', mode: 'dark' },
] as const;
const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: '390px', width: 390, height: 844 },
] as const;
const reportCard = {
  id: 'visual-report-card',
  word: 'resilient',
  normalizedWord: 'resilient',
  translation: 'kiên cường',
  explanation: 'Able to recover after difficulty.',
  explanationTranslation: 'Có khả năng phục hồi sau khó khăn.',
  phonetic: '/rɪˈzɪliənt/',
  emoji: '🌱',
  category: 'Vocabulary',
  audioUrl: null,
  imageUrl: null,
  createdAt: fixedTime.toISOString(),
  bookmarked: false,
  difficulty: 'unrated',
  origin: 'ai',
  customDeck: null,
};

async function expectAccessibleAndContained(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label} has horizontal overflow`).toBeLessThanOrEqual(1);
  const clipped = await page.locator('button:visible, input:visible, a:visible').evaluateAll(elements => elements
    .map(element => {
      const box = element.getBoundingClientRect();
      return { label: element.getAttribute('aria-label') || element.textContent?.trim(), left: box.left, right: box.right, width: box.width, height: box.height };
    })
    .filter(control => control.width > 0 && control.height > 0 && (control.left < -1 || control.right > window.innerWidth + 1)));
  expect(clipped, `${label} has horizontally clipped controls`).toEqual([]);

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const blocking = results.violations.filter(violation => violation.impact === 'serious' || violation.impact === 'critical');
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

async function captureDialogEvidence(dialog: Locator, testInfo: TestInfo, name: string) {
  const screenshot = testInfo.outputPath(`${name}.png`);
  const buffer = await dialog.screenshot({ path: screenshot, animations: 'disabled', caret: 'hide' });
  await testInfo.attach(name, { path: screenshot, contentType: 'image/png' });
  return buffer;
}

function expectDialogSnapshot(buffer: Buffer, name: string) {
  expect(buffer).toMatchSnapshot(name, { maxDiffPixelRatio: 0.01 });
}

async function openManagementMenu(page: Page) {
  await page.getByRole('button', { name: 'Manage library' }).click();
  await expect(page.getByRole('menu', { name: 'Library management' })).toBeVisible();
}

for (const theme of themes) for (const viewport of viewports) {
  test(`${theme.family} ${theme.mode} account, plan, and report dialogs match the signed-in shell at ${viewport.name}`, async ({ page, seedCards, seedCourseProfile, signIn, blockExternalNetwork }, testInfo) => {
    await page.clock.setFixedTime(fixedTime);
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: theme.mode, reducedMotion: 'reduce' });
    await blockExternalNetwork(page);
    await page.addInitScript(({ family, mode }) => {
      localStorage.setItem('sonflash_theme_family', family);
      localStorage.setItem('lingoflash_theme', mode);
      localStorage.setItem('sonflash_theme_follow_system', 'false');
      localStorage.setItem('sonflash_reduced_motion', 'true');
    }, theme);
    await seedCards([reportCard]);
    await seedCourseProfile();
    await signIn(page, '/?view=library&locale=en');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });

    await openManagementMenu(page);
    await page.getByRole('menuitem', { name: 'See Pro plan' }).click();
    await expect(page.getByRole('heading', { name: 'Add momentum to your learning' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Loading plan details…')).toBeHidden({ timeout: 15_000 });
    await expectAccessibleAndContained(page, `${theme.family}-${theme.mode}-${viewport.name}-plan-dialog`);
    const planScreenshot = await captureDialogEvidence(page.getByRole('dialog', { name: 'Add momentum to your learning' }), testInfo, `landing-plan-${theme.family}-${theme.mode}-${viewport.name}`);
    await page.getByRole('button', { name: 'Close' }).first().click();
    await expect(page.getByRole('dialog')).toBeHidden();

    await openManagementMenu(page);
    await page.getByRole('menuitem', { name: 'Account data' }).click();
    await expect(page.getByRole('heading', { name: 'Account data' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download account data (JSON, excluding cards)' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Delete my account' })).toBeEnabled();
    await expectAccessibleAndContained(page, `${theme.family}-${theme.mode}-${viewport.name}-account-dialog`);
    const accountDialog = page.getByRole('dialog', { name: 'Account data' });
    const accountScreenshot = await captureDialogEvidence(accountDialog, testInfo, `landing-account-${theme.family}-${theme.mode}-${viewport.name}`);
    await page.getByRole('button', { name: 'Delete my account' }).click();
    await expect(page.getByLabel(/Type XÓA TÀI KHOẢN/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm permanent deletion' })).toBeDisabled();
    await expectAccessibleAndContained(page, `${theme.family}-${theme.mode}-${viewport.name}-account-delete-confirmation`);
    const accountConfirmationScreenshot = await captureDialogEvidence(accountDialog, testInfo, `landing-account-delete-confirmation-${theme.family}-${theme.mode}-${viewport.name}`);
    await page.getByRole('button', { name: 'Close' }).last().click();
    await expect(page.getByRole('dialog')).toBeHidden();

    await page.locator(`[data-library-card-id="${reportCard.id}"] .library-word-open`).click();
    await page.getByRole('button', { name: /Reveal the Vietnamese meaning of resilient/ }).click();
    await page.getByRole('button', { name: 'Report incorrect card' }).click();
    await expect(page.getByRole('heading', { name: 'Report a wrong card' })).toBeVisible();
    await expectAccessibleAndContained(page, `${theme.family}-${theme.mode}-${viewport.name}-report-request`);
    const reportDialog = page.getByRole('dialog', { name: 'Report a wrong card' });
    const reportRequestScreenshot = await captureDialogEvidence(reportDialog, testInfo, `landing-report-request-${theme.family}-${theme.mode}-${viewport.name}`);
    await page.getByLabel('Note').fill('The Vietnamese meaning needs review.');
    await page.getByRole('button', { name: 'Send report' }).click();
    await expect(reportDialog.getByRole('status')).toContainText(
      'Thank you. Your report has been sent for review.',
      { timeout: 15_000 },
    );
    await expectAccessibleAndContained(page, `${theme.family}-${theme.mode}-${viewport.name}-report-submitted`);
    const reportSubmittedScreenshot = await captureDialogEvidence(reportDialog, testInfo, `landing-report-submitted-${theme.family}-${theme.mode}-${viewport.name}`);

    expectDialogSnapshot(planScreenshot, `landing-plan-${theme.family}-${theme.mode}-${viewport.name}.png`);
    expectDialogSnapshot(accountScreenshot, `landing-account-${theme.family}-${theme.mode}-${viewport.name}.png`);
    expectDialogSnapshot(accountConfirmationScreenshot, `landing-account-delete-confirmation-${theme.family}-${theme.mode}-${viewport.name}.png`);
    expectDialogSnapshot(reportRequestScreenshot, `landing-report-request-${theme.family}-${theme.mode}-${viewport.name}.png`);
    expectDialogSnapshot(reportSubmittedScreenshot, `landing-report-submitted-${theme.family}-${theme.mode}-${viewport.name}.png`);
  });
}

test('account JSON download contains account data without card contents', async ({ page, seedCards, seedCourseProfile, signIn, blockExternalNetwork }, testInfo) => {
  await seedCards([reportCard]);
  await seedCourseProfile();
  await blockExternalNetwork(page);
  await signIn(page, '/?view=library&locale=en');
  await openManagementMenu(page);
  await page.getByRole('menuitem', { name: 'Account data' }).click();
  await expect(page.getByRole('heading', { name: 'Account data' })).toBeVisible();
  const downloadButton = page.getByRole('button', { name: 'Download account data (JSON, excluding cards)' });
  await expect(downloadButton).toBeEnabled();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    downloadButton.click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^sonflash-account-\d{4}-\d{2}-\d{2}\.json$/);
  const exportPath = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(exportPath);
  const exported = JSON.parse(await readFile(exportPath, 'utf8')) as Record<string, unknown>;
  expect(exported).toHaveProperty('exportedAt');
  expect(exported).toHaveProperty('profile');
  expect(exported).not.toHaveProperty('cards');
  expect(JSON.stringify(exported)).not.toContain(reportCard.word);
});

test('upgrade dialog records purchase intent and reflects active Pro entitlement', async ({
  page, db, testUser, seedCards, seedCourseProfile, signIn, blockExternalNetwork,
}) => {
  await seedCards([reportCard]);
  await seedCourseProfile();
  await blockExternalNetwork(page);
  await signIn(page, '/?view=library&locale=en');

  await openManagementMenu(page);
  await page.getByRole('menuitem', { name: 'See Pro plan' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add momentum to your learning' });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  const registerButton = dialog.getByRole('button', { name: 'Register interest for launch' });
  await expect(registerButton).toBeEnabled({ timeout: 15_000 });
  await registerButton.click();
  await expect(dialog).toContainText(
    'Your purchase interest is recorded. The founder will reach out when sales open.',
    { timeout: 15_000 },
  );

  const intents = await db.collection('analytics_events').where('name', '==', 'purchase_intent').get();
  expect(intents.docs.some(doc => {
    const props = doc.data()?.props as Record<string, unknown> | undefined;
    return props?.offerId === 'pro-vn-30d-v1' && props?.trigger === 'menu';
  })).toBe(true);

  await dialog.getByRole('button', { name: 'Close' }).first().click();
  await expect(dialog).toBeHidden();

  const startsAt = new Date();
  const expiresAt = new Date(startsAt.getTime() + 30 * 86_400_000);
  await db.doc(`users/${testUser.uid}/entitlements/e2e-pro`).set({
    tier: 'pro',
    source: 'operator',
    startsAt,
    expiresAt,
    status: 'active',
    reason: 'e2e-pro-grant',
    createdAt: startsAt,
    revokedAt: null,
  });

  await openManagementMenu(page);
  await page.getByRole('menuitem', { name: 'See Pro plan' }).click();
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(dialog).toContainText('Pro is already active on your account.', { timeout: 15_000 });
  await expect(dialog.getByRole('button', { name: 'Register interest for launch' })).toHaveCount(0);
});
