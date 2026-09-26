import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

const fixturePath = '/e2e/fixtures/shell-share-workflow.html';
const themes = [
  { family: 'classic', mode: 'dark' },
  { family: 'classic', mode: 'light' },
  { family: 'crystal', mode: 'dark' },
  { family: 'crystal', mode: 'light' },
] as const;
const viewportLocales = [
  { locale: 'en', name: 'en', width: 1440, height: 900 },
  { locale: 'vi', name: 'vi', width: 1440, height: 900 },
  { locale: 'en', name: 'en', width: 390, height: 844 },
  { locale: 'vi', name: 'vi', width: 390, height: 844 },
  { locale: 'pseudo', name: 'en-xa', width: 360, height: 844 },
] as const;

function fixtureUrl(query: Record<string, string>) {
  return `${fixturePath}?${new URLSearchParams(query).toString()}`;
}

async function preparePage(
  page: Page,
  theme: typeof themes[number],
  viewport: typeof viewportLocales[number],
  options: { lumiEnabled?: boolean; reducedMotionEnabled?: boolean } = {},
) {
  const { lumiEnabled = true, reducedMotionEnabled = true } = options;
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.emulateMedia({ colorScheme: theme.mode, reducedMotion: reducedMotionEnabled ? 'reduce' : 'no-preference' });
  await page.addInitScript(({ family, mode, lumiEnabled: isLumiEnabled, reducedMotionEnabled: isReducedMotionEnabled }) => {
    localStorage.setItem('sonflash_theme_family', family);
    localStorage.setItem('lingoflash_theme', mode);
    localStorage.setItem('sonflash_theme_follow_system', 'false');
    localStorage.setItem('sonflash_reduced_motion', String(isReducedMotionEnabled));
    localStorage.setItem('sonflash_lumi_enabled', String(isLumiEnabled));
  }, { ...theme, lumiEnabled, reducedMotionEnabled });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:4176)/, route => route.abort());
}

async function openFixture(page: Page, query: Record<string, string>) {
  await page.goto(fixtureUrl(query));
  await expect(page.locator('[data-shell-share-fixture]')).toBeVisible({ timeout: 15_000 });
}

async function runAdapterControl(page: Page, control: keyof NonNullable<Window['__shellShareControls']>) {
  await page.waitForFunction(() => Boolean(window.__shellShareControls));
  await page.evaluate(name => window.__shellShareControls?.[name](), control);
}

async function expectAccessibleAndContained(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label} has horizontal page overflow`).toBeLessThanOrEqual(1);
  const clipped = await page.locator('button:visible, input:visible, select:visible, textarea:visible').evaluateAll(elements => elements.map(element => {
    const bounds = element.getBoundingClientRect();
    return {
      name: element.getAttribute('aria-label') || element.textContent?.trim(),
      left: bounds.left,
      right: bounds.right,
      width: bounds.width,
      height: bounds.height,
    };
  }).filter(control => control.width > 0 && control.height > 0 && (control.left < -1 || control.right > window.innerWidth + 1)));
  expect(clipped, `${label} has horizontally clipped controls`).toEqual([]);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const blocking = results.violations.filter(violation => violation.impact === 'serious' || violation.impact === 'critical');
  expect(blocking, `${label} axe blockers: ${JSON.stringify(blocking, null, 2)}`).toEqual([]);
}

async function expectReducedMotion(page: Page, label: string) {
  const animations = await page.evaluate(() => document.getAnimations()
    .filter(animation => Number(animation.effect?.getComputedTiming().duration ?? 0) > 1)
    .map(animation => animation.effect instanceof KeyframeEffect && animation.effect.target instanceof Element
      ? getComputedStyle(animation.effect.target).animationName
      : 'unnamed animation'));
  expect(animations, `${label} has animation despite reduced motion`).toEqual([]);
}

async function inspectShareScrollLayout(dialog: Locator, targetSelector: string) {
  return dialog.locator('[data-share-dialog-body]').evaluate((body, selector) => {
    const scrollport = body.querySelector<HTMLElement>('.share-dialog-scroll[role="region"][tabindex="0"]');
    const target = body.querySelector<HTMLElement>(selector);
    const footer = body.querySelector<HTMLElement>(':scope > div:last-child');
    const rect = (element: Element | null) => {
      if (!element) return null;
      const bounds = element.getBoundingClientRect();
      return { top: bounds.top, right: bounds.right, bottom: bounds.bottom, left: bounds.left, width: bounds.width, height: bounds.height };
    };

    return {
      scrollport: rect(scrollport),
      scrollHeight: scrollport?.scrollHeight ?? 0,
      clientHeight: scrollport?.clientHeight ?? 0,
      scrollTop: scrollport?.scrollTop ?? 0,
      target: rect(target),
      footer: rect(footer),
      footerButtons: [...(footer?.querySelectorAll('button') ?? [])].map(button => rect(button)),
      viewportHeight: window.innerHeight,
    };
  }, targetSelector);
}

async function expectMobileShareKeyboardReachability(
  page: Page,
  dialog: Locator,
  flow: 'incoming' | 'outgoing',
  themeFamily: typeof themes[number]['family'],
  label: string,
) {
  const region = dialog.locator('[data-share-dialog-body] .share-dialog-scroll[role="region"][tabindex="0"]');
  const targetSelector = flow === 'incoming'
    ? '[data-share-preview="incoming"] .share-dialog-safeguard'
    : '[data-share-preview="outgoing"] .share-dialog-privacy-warning';
  const sampleRail = dialog.locator('[data-share-preview="incoming"] .share-dialog-sample-rail');
  const footerButtons = dialog.locator('[data-share-dialog-body] > div:last-child button');
  const copyInput = dialog.locator('[data-share-preview="outgoing"] input[readonly]');
  const copyButton = dialog.locator('[data-share-preview="outgoing"] button.share-dialog-copy-action');

  await expect(region, `${label} has a focusable share content region`).toBeVisible();
  await expect(footerButtons, `${label} keeps both footer actions`).toHaveCount(2);
  if (flow === 'incoming') {
    await expect(dialog.locator(targetSelector), `${label} contains the copy-safety text`).toHaveText(/\S.{20,}/s);
  }
  const initial = await inspectShareScrollLayout(dialog, targetSelector);
  expect(initial.scrollport, `${label} has a measurable scrollport`).not.toBeNull();
  expect(initial.target, `${label} has its lower safety/control content`).not.toBeNull();
  expect(initial.footer, `${label} has a separate footer`).not.toBeNull();
  if (!initial.scrollport || !initial.target || !initial.footer) throw new Error(`${label} is missing its scrollport, target, or footer.`);

  const hasVerticalOverflow = initial.scrollHeight > initial.clientHeight;
  await region.focus();
  await expect(region).toBeFocused();
  if (hasVerticalOverflow) {
    await page.keyboard.press('PageDown');
    await expect.poll(async () => (await inspectShareScrollLayout(dialog, targetSelector)).scrollTop, {
      message: `${label} PageDown scrolls the focused share content region`,
    }).toBeGreaterThan(0);
    await page.keyboard.press('End');
    await expect.poll(async () => {
      const layout = await inspectShareScrollLayout(dialog, targetSelector);
      return layout.scrollTop - (layout.scrollHeight - layout.clientHeight);
    }, {
      message: `${label} End reaches the bottom of the share content region`,
    }).toBeGreaterThanOrEqual(-1);
  }

  const scrolled = await inspectShareScrollLayout(dialog, targetSelector);
  if (hasVerticalOverflow) {
    expect(scrolled.scrollTop, `${label} End reaches the lower share content`).toBeGreaterThan(0);
  } else {
    expect(scrolled.scrollHeight, `${label} content fits the visible scroll region`).toBeLessThanOrEqual(scrolled.clientHeight);
  }
  expect(scrolled.scrollport).not.toBeNull();
  expect(scrolled.target).not.toBeNull();
  expect(scrolled.footer).not.toBeNull();
  if (!scrolled.scrollport || !scrolled.target || !scrolled.footer) throw new Error(`${label} lost its scrollport, target, or footer.`);
  const port = scrolled.scrollport;
  const target = scrolled.target;
  const footer = scrolled.footer;
  expect(target.top, `${label} target starts within the visible scrollport`).toBeGreaterThanOrEqual(port.top - 1);
  expect(target.bottom, `${label} target ends within the visible scrollport`).toBeLessThanOrEqual(port.bottom + 1);
  expect(port.bottom, `${label} footer does not cover scrollable content`).toBeLessThanOrEqual(footer.top + 1);
  expect(footer.top, `${label} footer remains on screen`).toBeGreaterThanOrEqual(-1);
  expect(footer.bottom, `${label} footer remains on screen`).toBeLessThanOrEqual(scrolled.viewportHeight + 1);
  expect(scrolled.footerButtons.every(button => button !== null && button.top >= footer.top - 1 && button.bottom <= footer.bottom + 1),
    `${label} footer controls remain inside their visible footer`).toBe(true);

  if (flow === 'incoming') {
    await page.keyboard.press('Tab');
    await expect(sampleRail, `${label} Tab moves from vertical content to the sample rail`).toBeFocused();
    const railInitial = await sampleRail.evaluate(rail => ({
      clientWidth: rail.clientWidth,
      scrollWidth: rail.scrollWidth,
    }));
    if (themeFamily === 'crystal') {
      expect(railInitial.scrollWidth, `${label} Crystal sample rail can scroll horizontally`).toBeGreaterThan(railInitial.clientWidth);
      for (let step = 0; step < 16; step += 1) {
        const before = await sampleRail.evaluate(rail => rail.scrollLeft);
        const maximum = await sampleRail.evaluate(rail => rail.scrollWidth - rail.clientWidth);
        if (before >= maximum - 1) break;
        await page.keyboard.press('ArrowRight');
        await expect.poll(async () => sampleRail.evaluate(rail => rail.scrollLeft), {
          message: `${label} ArrowRight moves the focused Crystal sample rail`,
        }).toBeGreaterThan(before);
      }
      await expect.poll(async () => sampleRail.evaluate(rail => rail.scrollLeft - (rail.scrollWidth - rail.clientWidth)), {
        message: `${label} ArrowRight reaches the final Crystal sample tile`,
      }).toBeGreaterThanOrEqual(-1);
      const finalTileGeometry = await sampleRail.evaluate(rail => {
        const lastTile = rail.querySelector<HTMLElement>(':scope > ul > li:last-child');
        const railBounds = rail.getBoundingClientRect();
        const tileBounds = lastTile?.getBoundingClientRect();
        return {
          scrollLeft: rail.scrollLeft,
          railWidth: rail.clientWidth,
          scrollWidth: rail.scrollWidth,
          left: tileBounds?.left ?? Number.NaN,
          right: tileBounds?.right ?? Number.NaN,
          railLeft: railBounds.left,
          railRight: railBounds.right,
        };
      });
      expect(finalTileGeometry.scrollLeft, `${label} horizontal rail reaches its last sample`).toBeGreaterThan(0);
      expect(finalTileGeometry.right, `${label} final sample tile ends inside the visible rail`).toBeLessThanOrEqual(finalTileGeometry.railRight + 1);
      expect(finalTileGeometry.left, `${label} final sample tile starts inside the visible rail`).toBeGreaterThanOrEqual(finalTileGeometry.railLeft - 1);
    }
    await page.keyboard.press('Tab');
    await expect(footerButtons.nth(0), `${label} Cancel remains keyboard reachable`).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(footerButtons.nth(1), `${label} Add remains keyboard reachable`).toBeFocused();
    return;
  }

  await expect(copyInput).toBeVisible();
  await expect(copyButton).toBeVisible();
  await expect(copyButton).toBeEnabled();
  await expect(copyButton).toHaveAttribute('aria-label', /\S+/);
  await page.keyboard.press('Tab');
  await expect(copyInput, `${label} share URL is in the keyboard order`).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(copyButton, `${label} Copy is in the keyboard order`).toBeFocused();
  await expect(copyButton, `${label} focused Copy is scrolled into view`).toBeInViewport();
  await page.keyboard.press('Tab');
  await expect(footerButtons.nth(0), `${label} Revoke remains keyboard reachable`).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(footerButtons.nth(1), `${label} Done remains keyboard reachable`).toBeFocused();
}

async function expectNoNotificationOverlap(page: Page, label: string) {
  const boxes = await page.locator('[data-notification-toast], [data-undo-toast]').evaluateAll(elements => elements
    .filter(element => {
      const bounds = element.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0;
    })
    .map(element => {
      const bounds = element.getBoundingClientRect();
      return { id: element.getAttribute('data-notification-toast') ? 'feedback' : 'undo', top: bounds.top, right: bounds.right, bottom: bounds.bottom, left: bounds.left };
    }));
  expect(boxes.filter(box => box.id === 'feedback'), `${label} should render all four feedback variants`).toHaveLength(4);
  expect(boxes.filter(box => box.id === 'undo'), `${label} should render its undo action`).toHaveLength(1);
  const collisions = boxes.flatMap((first, index) => boxes.slice(index + 1).filter(second => (
    Math.min(first.right, second.right) - Math.max(first.left, second.left) > 1
    && Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top) > 1
  )).map(second => [first.id, second.id]));
  expect(collisions, `${label} fixed notifications overlap`).toEqual([]);
  const lastFeedbackBottom = Math.max(...boxes.filter(box => box.id === 'feedback').map(box => box.bottom));
  const undoTop = boxes.find(box => box.id === 'undo')!.top;
  expect(undoTop - lastFeedbackBottom, `${label} should keep adjacent notifications in one stack`).toBeLessThanOrEqual(24);
}

async function expectUnstackedFeedbackBottom(page: Page, viewportWidth: number, label: string) {
  const bottom = await page.locator('[data-notification-viewport]').evaluate(element => Number.parseFloat(getComputedStyle(element).bottom));
  expect(bottom, `${label} should use its normal bottom when no Undo toast is present`).toBeLessThanOrEqual(viewportWidth >= 1024 ? 20 : 96);
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const screenshot = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: screenshot, fullPage: true, animations: 'disabled', caret: 'hide' });
  await testInfo.attach(name, { path: screenshot, contentType: 'image/png' });
}

for (const theme of themes) {
  for (const viewport of viewportLocales) {
    const matrixName = `${theme.family}-${theme.mode}-${viewport.name}-${viewport.width}`;
    test(`${matrixName} shell, share and system boards capture without blocking accessibility issues`, async ({ page }, testInfo) => {
      test.setTimeout(120_000);
      await preparePage(page, theme, viewport);
      const routeBase = { locale: viewport.locale };

      await openFixture(page, { ...routeBase, view: 'feedback' });
      const mobileNavigation = page.locator('nav[data-shell-layer="mobile"]');
      if (viewport.width < 1024) await expect(mobileNavigation).toBeVisible();
      else await expect(mobileNavigation).toBeHidden();
      await expect(page.locator('[data-notification-toast]')).toHaveCount(4);
      await expectUnstackedFeedbackBottom(page, viewport.width, `${matrixName}-feedback`);
      await expectAccessibleAndContained(page, `${matrixName}-feedback`);
      await expectReducedMotion(page, `${matrixName}-feedback`);
      await capture(page, testInfo, `feedback-${matrixName}`);

      await openFixture(page, { ...routeBase, view: 'combined' });
      await expect(page.locator('[data-notification-toast]')).toHaveCount(4);
      await expect(page.locator('[data-undo-toast]')).toBeVisible();
      await expectNoNotificationOverlap(page, `${matrixName}-combined-feedback-undo`);
      await expectAccessibleAndContained(page, `${matrixName}-combined-feedback-undo`);
      await expectReducedMotion(page, `${matrixName}-combined-feedback-undo`);
      await capture(page, testInfo, `feedback-and-undo-${matrixName}`);

      await openFixture(page, { ...routeBase, view: 'system', state: 'loading' });
      await expect(page.getByRole('status')).toBeVisible();
      if (theme.family === 'crystal') {
        await expect(page.locator('[data-lumi-pose="thinking"]')).toBeVisible();
      }
      await expectAccessibleAndContained(page, `${matrixName}-loading`);
      await expectReducedMotion(page, `${matrixName}-loading`);
      await capture(page, testInfo, `system-loading-${matrixName}`);

      await openFixture(page, { ...routeBase, view: 'system', state: 'error' });
      await expect(page.getByRole('alert')).toContainText('Your saved data is safe.');
      await expectAccessibleAndContained(page, `${matrixName}-error`);
      await expectReducedMotion(page, `${matrixName}-error`);
      await capture(page, testInfo, `system-error-${matrixName}`);

      await openFixture(page, { ...routeBase, view: 'today-caught-up' });
      await expect(page.locator('[data-today-caught-up="true"]')).toBeVisible();
      await expect(page.locator('[data-today-caught-up="true"] .today-caught-up-primary')).toBeDisabled();
      await expectAccessibleAndContained(page, `${matrixName}-today-caught-up`);
      await expectReducedMotion(page, `${matrixName}-today-caught-up`);
      await capture(page, testInfo, `today-caught-up-${matrixName}`);

      await openFixture(page, { ...routeBase, view: 'empty-library' });
      await expect(page.locator('[data-empty-library-panel="true"]')).toBeVisible();
      await expect(page.locator('[data-empty-library-panel="true"] button[type="submit"]')).toBeDisabled();
      if (theme.family === 'crystal') await expect(page.locator('[data-lumi-pose="sleepy"]')).toBeVisible();
      await expectAccessibleAndContained(page, `${matrixName}-empty-library`);
      await expectReducedMotion(page, `${matrixName}-empty-library`);
      await capture(page, testInfo, `empty-library-${matrixName}`);

      await openFixture(page, { ...routeBase, view: 'account' });
      const accountMenu = page.locator('button[aria-controls="library-management-menu"]');
      await accountMenu.press('ArrowDown');
      const menu = page.locator('#library-management-menu');
      await expect(menu).toBeVisible();
      await expect(menu.getByRole('menuitem').first()).toBeFocused();
      await expect(menu.locator('.account-menu-sync-action'), `${matrixName} exposes Sync now for the authenticated account`).toBeVisible();
      await expect(menu.locator('.account-menu-sync-action')).toBeEnabled();
      const exportAction = menu.getByRole('menuitem').filter({ hasText: /Excel/i });
      await expect(exportAction, `${matrixName} exposes Export library to Excel`).toHaveCount(1);
      await expect(exportAction).toBeVisible();
      await expect(exportAction).toBeEnabled();
      const clearAction = menu.locator('.account-menu-danger-action');
      await expect(clearAction, `${matrixName} exposes the final Clear library action`).toBeVisible();
      await expect(clearAction).toBeEnabled();
      await page.keyboard.press('Escape');
      await expect(accountMenu).toBeFocused();
      await accountMenu.click();
      if (viewport.width < 1024) {
        const accountProfile = page.locator('.account-menu-identity');
        const accountStatus = page.locator('.account-menu-status');
        await expect(accountProfile, `${matrixName} shows the account profile in the initial mobile menu view`).toBeVisible();
        await expect(accountStatus, `${matrixName} shows the sync status in the initial mobile menu view`).toBeVisible();
        const profileBounds = await accountProfile.evaluate(profile => {
          const bounds = profile.getBoundingClientRect();
          return { top: bounds.top, bottom: bounds.bottom };
        });
        expect(profileBounds.top, `${matrixName} mobile profile begins within the viewport`).toBeGreaterThanOrEqual(0);
        expect(profileBounds.bottom, `${matrixName} mobile profile is not clipped below the viewport`).toBeLessThanOrEqual(viewport.height);
      }
      await expectAccessibleAndContained(page, `${matrixName}-account-menu`);
      await expectReducedMotion(page, `${matrixName}-account-menu`);
      await capture(page, testInfo, `account-menu-${matrixName}`);
      if (viewport.width < 1024) {
        await page.setViewportSize({ width: viewport.width, height: 560 });
        await menu.getByRole('menuitem').first().focus();
        await page.keyboard.press('End');
        await expect(clearAction, `${matrixName} End reaches the last authenticated account action`).toBeFocused();
        const menuGeometry = await page.locator('.account-menu-panel').evaluate(panel => {
          const finalAction = panel.querySelector<HTMLElement>('.account-menu-danger-action');
          const panelBounds = panel.getBoundingClientRect();
          const actionBounds = finalAction?.getBoundingClientRect();
          return {
            scrollHeight: panel.scrollHeight,
            clientHeight: panel.clientHeight,
            scrollTop: panel.scrollTop,
            panelTop: panelBounds.top,
            panelBottom: panelBounds.bottom,
            actionTop: actionBounds?.top ?? Number.NaN,
            actionBottom: actionBounds?.bottom ?? Number.NaN,
          };
        });
        expect(menuGeometry.scrollHeight, `${matrixName} full menu is scrollable on a short mobile viewport`).toBeGreaterThan(menuGeometry.clientHeight);
        expect(menuGeometry.scrollTop, `${matrixName} End scrolls the account menu to its last row`).toBeGreaterThan(0);
        expect(menuGeometry.actionTop, `${matrixName} final action is not hidden above the menu`).toBeGreaterThanOrEqual(menuGeometry.panelTop - 1);
        expect(menuGeometry.actionBottom, `${matrixName} final action stays reachable inside the menu`).toBeLessThanOrEqual(menuGeometry.panelBottom + 1);
        const mobileNav = page.locator('nav[data-shell-layer="mobile"]');
        await expect(mobileNav, `${matrixName} bottom navigation is present for the occlusion check`).toBeVisible();
        const clearHitTest = await clearAction.evaluate(button => {
          const bounds = button.getBoundingClientRect();
          const nav = document.querySelector<HTMLElement>('nav[data-shell-layer="mobile"]');
          const navTop = nav?.getBoundingClientRect().top ?? Number.NaN;
          const point = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
          return { buttonBottom: bounds.bottom, navTop, hitButton: Boolean(point && button.contains(point)) };
        });
        expect(clearHitTest.buttonBottom, `${matrixName} Clear row ends above the fixed mobile navigation`).toBeLessThanOrEqual(clearHitTest.navTop);
        expect(clearHitTest.hitButton, `${matrixName} the Clear button center is not occluded by mobile navigation`).toBe(true);
        await capture(page, testInfo, `account-menu-final-row-${matrixName}`);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
      }

      await openFixture(page, { ...routeBase, view: 'account', state: 'session-lost' });
      await expect(page.locator('[data-notification-toast][role="alert"]')).toContainText(
        viewport.locale === 'vi' ? 'Phiên đã kết thúc' : 'Session ended',
      );
      await expect(page.locator('[data-fixture-session-lost]')).toHaveText('true');
      const sessionLostTrigger = page.locator('button[aria-controls="library-management-menu"]');
      await sessionLostTrigger.click();
      const sessionLostMenu = page.locator('#library-management-menu');
      await expect(page.locator('.account-menu-status')).toHaveAttribute('data-status-kind', 'session-lost');
      await expect(sessionLostMenu.locator('.account-menu-sync-action')).toHaveCount(0);
      await expect(sessionLostMenu.getByRole('menuitem').filter({ hasText: /Sign out|Đăng xuất/i })).toHaveCount(0);
      await expect(sessionLostMenu.getByRole('menuitem').filter({ hasText: /Sign in again|Đăng nhập lại/i })).toBeVisible();
      await expectAccessibleAndContained(page, `${matrixName}-account-session-lost`);
      await expectReducedMotion(page, `${matrixName}-account-session-lost`);
      await capture(page, testInfo, `account-session-lost-${matrixName}`);

      await openFixture(page, { ...routeBase, view: 'account', state: 'connecting', identity: 'connecting' });
      await page.locator('button[aria-controls="library-management-menu"]').click();
      await expect(page.locator('#library-management-menu [role="menuitem"]').first()).toBeVisible();
      await expect(page.locator('#library-management-menu [role="status"]')).toHaveCount(0);
      const accountSyncStatus = page.locator('.account-menu-panel .account-menu-status[role="status"]');
      await expect(accountSyncStatus).toBeVisible();
      await expect(accountSyncStatus).toHaveAttribute('data-status-kind', 'checking');
      await expectAccessibleAndContained(page, `${matrixName}-account-connecting`);
      await capture(page, testInfo, `account-connecting-${matrixName}`);

      await openFixture(page, { ...routeBase, view: 'undo' });
      await expect(page.locator('[data-undo-toast]')).toContainText(
        viewport.locale === 'vi' ? 'Đã xóa thẻ khỏi thiết bị này.' : 'Card removed from this device.',
      );
      await expectAccessibleAndContained(page, `${matrixName}-undo`);
      await expectReducedMotion(page, `${matrixName}-undo`);
      await capture(page, testInfo, `undo-${matrixName}`);

      await openFixture(page, { ...routeBase, view: 'share', share: 'fixture-incoming' });
      const incomingDialog = page.getByRole('dialog');
      await expect(incomingDialog).toBeVisible();
      await expect(page.getByRole('heading', { name: 'IELTS' })).toBeVisible();
      await expectAccessibleAndContained(page, `${matrixName}-share-incoming`);
      await expectReducedMotion(page, `${matrixName}-share-incoming`);
      await capture(page, testInfo, `share-incoming-${matrixName}`);
      if (viewport.width < 1024) {
        await expectMobileShareKeyboardReachability(page, incomingDialog, 'incoming', theme.family, `${matrixName}-share-incoming`);
      }

      await openFixture(page, { ...routeBase, view: 'share' });
      await page.getByRole('button', { name: 'Create outgoing share' }).click();
      const outgoingDialog = page.getByRole('dialog');
      await expect(outgoingDialog).toBeVisible();
      await expect(page.locator('[data-share-preview="outgoing"] input')).toHaveValue(/share=fixture-created-/);
      await expectAccessibleAndContained(page, `${matrixName}-share-outgoing`);
      await expectReducedMotion(page, `${matrixName}-share-outgoing`);
      await capture(page, testInfo, `share-outgoing-${matrixName}`);
      if (viewport.width < 1024) {
        await expectMobileShareKeyboardReachability(page, outgoingDialog, 'outgoing', theme.family, `${matrixName}-share-outgoing`);
      }
    });
  }
}

test('account feedback dismissal, retry and menu identity actions use real shell components', async ({ page }) => {
  await preparePage(page, themes[0], viewportLocales[0]);
  await openFixture(page, { view: 'feedback', locale: 'en' });
  await expect(page.locator('[data-notification-toast]')).toHaveCount(4);

  await page.getByRole('button', { name: 'Dismiss sign-in message' }).click();
  await page.getByRole('button', { name: 'Dismiss system message' }).click();
  await page.getByRole('button', { name: 'Dismiss success message' }).click();
  await page.getByRole('button', { name: 'Dismiss sync status' }).click();
  await expect(page.locator('[data-notification-toast]')).toHaveCount(0);

  await openFixture(page, { view: 'account', locale: 'en' });
  const trigger = page.getByRole('button', { name: 'Manage library' });
  await trigger.click();
  const signedInMenu = page.getByRole('menu', { name: 'Library management' });
  await signedInMenu.locator('.account-menu-sync-action').click();
  await expect(page.locator('[data-account-sync-count]')).toHaveText('1');
  await expect(page.locator('[data-fixture-status]')).toHaveText('account:sync:requested');
  await trigger.click();
  await signedInMenu.getByRole('menuitem', { name: 'Export library to Excel' }).click();
  await expect(page.locator('[data-account-export-count]')).toHaveText('1');
  await expect(page.locator('[data-fixture-status]')).toHaveText('account:export:requested');
  await trigger.click();
  await signedInMenu.locator('.account-menu-danger-action').click();
  await expect(page.locator('[data-account-clear-count]')).toHaveText('1');
  await expect(page.locator('[data-account-clear-focus]')).toHaveText('library-management-menu');
  await expect(page.locator('[data-fixture-status]')).toHaveText('account:clear:requested');
  await trigger.click();
  await signedInMenu.getByRole('menuitem', { name: 'Sign out of cloud sync' }).click();
  await expect(page.locator('[data-fixture-identity]')).toHaveText('signed-out');
  await trigger.click();
  await page.getByRole('menuitem', { name: 'Sign in & sync' }).click();
  await expect(page.locator('[data-fixture-identity]')).toHaveText('authenticated');
});

test('expired account session retries through the shell and restores cached identity', async ({ page }) => {
  await preparePage(page, themes[0], viewportLocales[0]);
  await openFixture(page, { view: 'account', state: 'session-lost', auth: 'defer', locale: 'en' });

  const sessionAlert = page.locator('[data-notification-toast][role="alert"]');
  const retryButton = sessionAlert.locator('.notification-toast-action');
  await expect(sessionAlert).toContainText('Session ended');
  await expect(retryButton).toHaveAccessibleName('Sign in again');
  await retryButton.click();
  await expect(page.locator('[data-auth-retry-count]')).toHaveText('1');
  await expect(page.locator('[data-fixture-status]')).toHaveText('account:auth-retry:requested');
  await expect(page.locator('[data-fixture-gate-ready]')).toHaveText('auth');
  await expect(sessionAlert).toHaveAttribute('aria-busy', 'true');
  await expect(retryButton).toBeDisabled();
  await expect(retryButton).toHaveAccessibleName('Connecting…');

  const trigger = page.locator('button[aria-controls="library-management-menu"]');
  await trigger.click();
  const lostMenu = page.locator('#library-management-menu');
  await expect(lostMenu.locator('.account-menu-sync-action')).toHaveCount(0);
  await expect(lostMenu.getByRole('menuitem').filter({ hasText: /Sign out of cloud sync/ })).toHaveCount(0);
  await expect(lostMenu.getByRole('menuitem', { name: 'Sign in again' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.evaluate(() => window.__shellShareControls?.resolveAuth());
  await expect(page.locator('[data-fixture-gate-ready]')).toHaveText('');
  await expect(page.locator('[data-fixture-session-lost]')).toHaveText('false');
  await expect(page.locator('[data-fixture-auth-retrying]')).toHaveText('false');
  await expect(page.locator('[data-fixture-identity]')).toHaveText('authenticated');
  await expect(page.locator('[data-fixture-status]')).toHaveText('account:auth-recovered');
  await expect(sessionAlert).toHaveCount(0);

  await trigger.click();
  const recoveredMenu = page.locator('#library-management-menu');
  await expect(recoveredMenu.locator('.account-menu-sync-action')).toBeVisible();
  await expect(recoveredMenu.getByRole('menuitem', { name: 'Sign out of cloud sync' })).toBeVisible();
});

test('caught-up Today state keeps the learning reason, Browse paths action, and Canvas width', async ({ page }) => {
  await preparePage(page, themes[0], viewportLocales[0]);
  await openFixture(page, { view: 'today-caught-up', locale: 'en' });
  const panel = page.locator('.today-caught-up-panel[data-today-caught-up="true"]');
  const reason = page.locator('#today-caught-up-learn-reason');
  await expect(panel).toBeVisible();
  await expect(reason).toBeVisible();
  const desktopWidth = await panel.evaluate(element => element.getBoundingClientRect().width);
  expect(Math.abs(desktopWidth - 424), 'caught-up Today panel matches the 424px Canvas width on desktop').toBeLessThanOrEqual(1);
  await expect(page.getByRole('button', { name: 'Learn 5 new' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Browse paths' })).toBeEnabled();
  await expect(page.getByText('Next review')).toHaveCount(0);
  await expect(page.getByText('8 cards')).toHaveCount(0);
  await page.getByRole('button', { name: 'Browse paths' }).click();
  await expect(page.locator('[data-fixture-status]')).toHaveText('today:paths');

  await page.setViewportSize({ width: 390, height: 844 });
  await openFixture(page, { view: 'today-caught-up', locale: 'en' });
  await expect(panel).toBeVisible();
  await expect(reason).toBeVisible();
  const mobileGeometry = await panel.evaluate(element => ({
    width: element.getBoundingClientRect().width,
    availableWidth: element.parentElement?.getBoundingClientRect().width ?? 0,
  }));
  expect(mobileGeometry.width, 'caught-up Today panel stays at or below its 424px cap on mobile').toBeLessThanOrEqual(424);
  expect(Math.abs(mobileGeometry.width - mobileGeometry.availableWidth), 'caught-up Today panel uses the available mobile width').toBeLessThanOrEqual(1);
  await expect(page.getByRole('button', { name: 'Learn 5 new' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Browse paths' })).toBeEnabled();
});

test('Crystal caught-up Today panel keeps its Canvas frame size and visible reason', async ({ page }) => {
  await preparePage(page, themes[2], viewportLocales[0]);
  await openFixture(page, { view: 'today-caught-up', locale: 'en' });
  const panel = page.locator('.today-caught-up-panel[data-today-caught-up="true"]');
  const reason = page.locator('#today-caught-up-learn-reason');
  const learn = page.getByRole('button', { name: 'Learn 5 new' });
  await expect(panel).toBeVisible();
  await expect(reason).toBeVisible();
  await expect(learn).toBeDisabled();
  await expect(learn).toHaveAttribute('aria-describedby', 'today-caught-up-learn-reason');

  const desktopGeometry = await panel.evaluate(element => ({
    width: element.getBoundingClientRect().width,
    height: element.getBoundingClientRect().height,
    innerHeight: element.querySelector('.today-caught-up-panel-inner')?.getBoundingClientRect().height ?? 0,
  }));
  expect(Math.abs(desktopGeometry.width - 424), 'Crystal caught-up frame width on desktop').toBeLessThanOrEqual(1);
  expect(Math.abs(desktopGeometry.height - 300), 'Crystal caught-up frame height on desktop').toBeLessThanOrEqual(1);
  expect(Math.abs(desktopGeometry.innerHeight - 297), 'Crystal caught-up inner height on desktop').toBeLessThanOrEqual(1);

  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 844 });
    await openFixture(page, { view: 'today-caught-up', locale: 'en' });
    await expect(panel).toBeVisible();
    await expect(reason).toBeVisible();
    const mobileGeometry = await panel.evaluate(element => ({
      width: element.getBoundingClientRect().width,
      height: element.getBoundingClientRect().height,
      availableWidth: element.parentElement?.getBoundingClientRect().width ?? 0,
      innerHeight: element.querySelector('.today-caught-up-panel-inner')?.getBoundingClientRect().height ?? 0,
    }));
    expect(mobileGeometry.width, `Crystal caught-up panel stays capped at ${width}px viewport`).toBeLessThanOrEqual(424);
    expect(Math.abs(mobileGeometry.width - mobileGeometry.availableWidth), `Crystal caught-up panel uses available width at ${width}px`).toBeLessThanOrEqual(1);
    expect(mobileGeometry.height, `Crystal caught-up panel keeps its minimum height at ${width}px`).toBeGreaterThanOrEqual(300);
    expect(mobileGeometry.innerHeight, `Crystal caught-up inner keeps its minimum height at ${width}px`).toBeGreaterThanOrEqual(297);
    await expect(learn).toBeDisabled();
    await expect(learn).toHaveAttribute('aria-describedby', 'today-caught-up-learn-reason');
  }
});

test('empty-library controls keep generation gated until input and route imports and paths', async ({ page }) => {
  await preparePage(page, themes[0], viewportLocales[0]);
  await openFixture(page, { view: 'empty-library', locale: 'en' });
  const generate = page.getByRole('button', { name: 'Generate card' });
  const word = page.getByRole('textbox', { name: 'English word' });
  await expect(generate).toBeDisabled();
  await word.fill('adapt');
  await expect(generate).toBeEnabled();
  await generate.click();
  await expect(page.locator('[data-fixture-status]')).toHaveText('empty-library:generate-requested');

  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import CSV / Excel' }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: 'cards.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('word,translation\nadapt,thích nghi'),
  });
  await expect(page.locator('[data-fixture-status]')).toHaveText('empty-library:import-selected');
  await page.getByRole('button', { name: 'Browse paths' }).click();
  await expect(page.locator('[data-fixture-status]')).toHaveText('empty-library:paths');
});

test('Crystal loading Lumi follows the saved off preference', async ({ page }) => {
  await preparePage(page, themes[2], viewportLocales[0], { lumiEnabled: false });
  await openFixture(page, { view: 'system', state: 'loading', locale: 'en' });
  const lumi = page.locator('[data-lumi-pose="thinking"]');
  await expect(page.locator('html')).toHaveAttribute('data-lumi', 'off');
  await expect(lumi).toHaveCount(1);
  await expect(lumi).toBeHidden();
  await expect(page.getByRole('status')).toBeVisible();
});

test('UndoToast pauses on hover and focus, executes Undo once, and can be dismissed', async ({ page }) => {
  await page.clock.install();
  await preparePage(page, themes[0], viewportLocales[0], { reducedMotionEnabled: false });
  await openFixture(page, { view: 'undo', locale: 'en' });
  const toast = page.locator('[data-undo-toast]');
  await expect(toast).toBeVisible();
  await toast.hover();
  await expect(toast.locator('.undo-toast-progress')).toHaveCSS('animation-play-state', 'paused');
  await page.clock.runFor(5_100);
  await expect(toast).toBeVisible();

  await toast.getByRole('button', { name: 'Undo' }).focus();
  await page.mouse.move(0, 0);
  await page.clock.runFor(5_100);
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(toast).toBeHidden();
  await expect(page.locator('[data-undo-cards]')).toHaveText('adapt, benefit');
  expect(await page.evaluate(() => window.__shellShareUndoCount)).toBe(1);

  await page.getByRole('button', { name: 'Remove adapt card' }).click();
  await expect(page.locator('[data-undo-cards]')).toHaveText('benefit');
  const secondToast = page.locator('[data-undo-toast]');
  await secondToast.getByRole('button', { name: 'Dismiss notification' }).click();
  await expect(secondToast).toBeHidden();
  await expect(page.locator('[data-undo-cards]')).toHaveText('benefit');
  expect(await page.evaluate(() => window.__shellShareUndoCount)).toBe(1);
});

test('shared deck create, copy, revoke and focus recovery use the real session controller', async ({ page }) => {
  await preparePage(page, themes[0], viewportLocales[0]);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:4176' });
  await openFixture(page, { view: 'share', locale: 'en', revoke: 'fail-once' });
  const create = page.getByRole('button', { name: 'Create outgoing share' });
  await create.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const link = dialog.getByRole('textbox', { name: 'Vocabulary deck share link' });
  await expect(link).toHaveValue(/share=fixture-created-1/);
  const shareLink = await link.inputValue();

  await dialog.getByRole('button', { name: 'Copy share link' }).click();
  await expect(dialog.getByRole('button', { name: 'Copy share link' })).toContainText('Copied');
  await expect.poll(() => page.evaluate(async () => navigator.clipboard.readText())).toBe(shareLink);

  await dialog.getByRole('button', { name: 'Revoke link' }).click();
  await expect(dialog.getByText('Could not revoke this share link right now. Please try again.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Dismiss share error' }).click();
  await dialog.getByRole('button', { name: 'Revoke link' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('The shared deck link has been revoked.')).toBeVisible();
  await expect(create).toBeFocused();
});

test('a created share link loads after navigation and repeat import reuses local fixture cards', async ({ page }) => {
  await preparePage(page, themes[0], viewportLocales[0]);
  await openFixture(page, { view: 'share', locale: 'en' });
  await page.getByRole('button', { name: 'Create outgoing share' }).click();
  const outgoing = page.getByRole('dialog');
  await expect(outgoing).toBeVisible();
  const link = await outgoing.locator('[data-share-preview="outgoing"] input').inputValue();
  const linkUrl = new URL(link);

  await page.goto(`${linkUrl.pathname}${linkUrl.search}`);
  let incoming = page.getByRole('dialog');
  await expect(incoming).toBeVisible();
  await incoming.getByRole('button', { name: 'Add 12 cards' }).click();
  await expect(incoming).toBeHidden();
  await expect(page.getByText('Added 12 new cards from the shared link.')).toBeVisible();
  expect(await page.evaluate(() => window.__shellShareAdoptedCount)).toBe(12);

  await page.goto(`${linkUrl.pathname}${linkUrl.search}`);
  incoming = page.getByRole('dialog');
  await expect(incoming).toBeVisible();
  await incoming.getByRole('button', { name: 'Add 12 cards' }).click();
  await expect(incoming).toBeHidden();
  await expect(page.getByText('Added 0 new cards from the shared link; reused 12 already in your library.')).toBeVisible();
});

test('share creation failure recovers, and duplicate create while busy is rejected', async ({ page }) => {
  await preparePage(page, themes[0], viewportLocales[0]);
  await openFixture(page, { view: 'share', locale: 'en', create: 'fail-once' });
  const create = page.getByRole('button', { name: 'Create outgoing share' });
  await create.click();
  await expect(page.getByText('Could not create a share link right now. Please try again.')).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss system message' }).click();
  await create.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('[data-fixture-action-status]')).toHaveText('create:created');

  await openFixture(page, { view: 'share', locale: 'en', create: 'defer' });
  await page.getByRole('button', { name: 'Create outgoing share' }).click();
  await expect(page.locator('[data-fixture-gate-ready]')).toHaveText('create');
  await runAdapterControl(page, 'repeatCreate');
  await expect(page.locator('[data-fixture-action-status]')).toHaveText('create:busy');
  await runAdapterControl(page, 'resolveCreate');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('[data-fixture-action-status]')).toHaveText('create:created');
});

test('incoming shared deck loading, failure, acceptance retry, cancel and focus recovery', async ({ page }) => {
  await preparePage(page, themes[0], viewportLocales[0]);
  await openFixture(page, { view: 'share', locale: 'en', share: 'fixture-incoming', load: 'defer' });
  await expect(page.getByRole('status').filter({ hasText: 'Preparing the shared deck…' })).toBeVisible();
  await expect(page.locator('[data-fixture-gate-ready]')).toHaveText('load');
  await runAdapterControl(page, 'resolveLoad');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  await openFixture(page, { view: 'share', locale: 'en', share: 'fixture-incoming', adoption: 'fail-once' });
  const incoming = page.getByRole('dialog');
  await incoming.getByRole('button', { name: 'Add 12 cards' }).click();
  await expect(incoming.getByText('Could not add this shared deck safely. Please try again.')).toBeVisible();
  await incoming.getByRole('button', { name: 'Dismiss share error' }).click();
  await incoming.getByRole('button', { name: 'Add 12 cards' }).click();
  await expect(incoming).toBeHidden();
  await expect(page.locator('[data-fixture-status]')).toHaveText('accept:accepted');
  expect(await page.evaluate(() => window.__shellShareAdoptedCount)).toBe(12);
  await expect(page).not.toHaveURL(/share=fixture-incoming/);

  await openFixture(page, { view: 'share', locale: 'en', share: 'fixture-incoming', adoption: 'defer' });
  const busyDialog = page.getByRole('dialog');
  await busyDialog.getByRole('button', { name: 'Add 12 cards' }).click();
  await expect(busyDialog.getByRole('button', { name: 'Adding…' })).toBeDisabled();
  await expect(page.locator('[data-fixture-gate-ready]')).toHaveText('adoption');
  await runAdapterControl(page, 'repeatAccept');
  await expect(page.locator('[data-fixture-action-status]')).toHaveText('accept:busy');
  await runAdapterControl(page, 'resolveAdoption');
  await expect(busyDialog).toBeHidden();

  await openFixture(page, { view: 'share', locale: 'en', share: 'fixture-incoming' });
  const cancelDialog = page.getByRole('dialog');
  await cancelDialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(cancelDialog).toBeHidden();
  await expect(page).not.toHaveURL(/share=fixture-incoming/);
  await expect(page.getByRole('heading', { name: 'Share a real deck fixture' })).toBeFocused();
});

test('missing and failed share links show recoverable shell feedback without importing cards', async ({ page }) => {
  await preparePage(page, themes[0], viewportLocales[0]);
  await openFixture(page, { view: 'share', locale: 'en', share: 'fixture-incoming', load: 'fail' });
  await expect(page.getByText('Could not load this shared deck safely. No cards were added.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await openFixture(page, { view: 'share', locale: 'en', share: 'fixture-missing' });
  await expect(page.getByText('Could not load this shared deck safely. No cards were added.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => window.__shellShareAdoptedCount)).toBeUndefined();
});

test('share revoke busy state blocks a duplicate controller operation', async ({ page }) => {
  await preparePage(page, themes[0], viewportLocales[0]);
  await openFixture(page, { view: 'share', locale: 'en', revoke: 'defer' });
  await page.getByRole('button', { name: 'Create outgoing share' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Revoke link' }).click();
  await expect(dialog.getByRole('button', { name: 'Revoking…' })).toBeDisabled();
  await expect(page.locator('[data-fixture-gate-ready]')).toHaveText('revoke');
  await runAdapterControl(page, 'repeatRevoke');
  await expect(page.locator('[data-fixture-action-status]')).toHaveText('revoke:busy');
  await runAdapterControl(page, 'resolveRevoke');
  await expect(dialog).toBeHidden();
});

declare global {
  interface Window {
    __shellShareControls?: {
      repeatCreate: () => void;
      repeatAccept: () => void;
      repeatRevoke: () => void;
      resolveLoad: () => void;
      resolveCreate: () => void;
      resolveRevoke: () => void;
      resolveAdoption: () => void;
      resolveAuth: () => void;
    };
  }
}
