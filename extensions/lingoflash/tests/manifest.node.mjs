import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const manifest = JSON.parse(
  await readFile(new URL('../manifest.json', import.meta.url), 'utf8'),
);

test('keeps Chrome manifest description within the published limit', () => {
  assert.equal(manifest.version, '1.3.3');
  assert.equal(manifest.background?.service_worker, 'background.js');
  assert.equal(manifest.options_page, undefined);
  assert.ok(
    typeof manifest.description === 'string'
      && manifest.description.length <= 132,
    `manifest description is ${manifest.description?.length ?? 0} characters; Chrome allows at most 132`,
  );
});
