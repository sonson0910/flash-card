import { readdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test('spreadsheet export downloads an XLSX through the browser', async ({ page }) => {
  const miniChunk = readdirSync('dist/assets').find(name => /^xlsx\.mini\.min-[\w-]+\.js$/.test(name));
  expect(miniChunk).toBeDefined();

  await page.goto('/?view=landing');
  const download = page.waitForEvent('download');
  await page.evaluate(async assetPath => {
    const module = await import(/* @vite-ignore */ assetPath);
    const xlsx = Object.values(module).find(value => value && typeof value === 'object' && 'utils' in value && 'writeFile' in value) as typeof import('@e965/xlsx') | undefined;
    if (!xlsx) throw new Error('Built spreadsheet module has no export API');
    const sheet = xlsx.utils.json_to_sheet([{ Word: 'apple', Translation: 'táo' }]);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, sheet, 'Flashcards');
    xlsx.writeFile(workbook, 'SonFlash_Export.xlsx');
  }, `/assets/${miniChunk}`);

  expect((await download).suggestedFilename()).toBe('SonFlash_Export.xlsx');
});
