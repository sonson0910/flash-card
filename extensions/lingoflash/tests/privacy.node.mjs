import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const popupSource = await readFile(new URL('../popup.html', import.meta.url), 'utf8');
const readmeSource = await readFile(new URL('../README.md', import.meta.url), 'utf8');
const privacySource = await readFile(new URL('../../../public/browser-extension-privacy.html', import.meta.url), 'utf8');

test('publishes the privacy policy URL and the two data-flow disclosures', () => {
  const policyUrl = 'https://encoded-hangout-433912-h2.web.app/browser-extension-privacy.html';
  assert.match(popupSource, new RegExp(policyUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(readmeSource, new RegExp(policyUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(privacySource, /Google Translate/);
  assert.match(privacySource, /LingoFlash.*Gemini|Gemini.*LingoFlash/);
  assert.match(privacySource, /Firebase token/);
  assert.match(privacySource, /mật khẩu/);
});
