import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const uiSource = await readFile(new URL('../background-v132-ui.js', import.meta.url), 'utf8');
const coreSource = await readFile(new URL('../background-v132-core.js', import.meta.url), 'utf8');

test('keeps complete card example fields in the inline result path', () => {
  assert.match(coreSource, /exampleSentence/);
  assert.match(coreSource, /exampleTranslation/);
  assert.match(uiSource, /exampleSentence/);
  assert.match(uiSource, /exampleTranslation/);
});

test('provides an accessible live status and auth link in the inline bubble', () => {
  assert.match(uiSource, /setAttribute\(['"]role['"],\s*['"]status['"]\)/);
  assert.match(uiSource, /aria-live/);
  assert.match(uiSource, /loginUrl/);
  assert.match(uiSource, /prefers-reduced-motion/);
});

test('reports failure when an existing host element has no shadow root', () => {
  const context = {
    document: { getElementById: () => ({ shadowRoot: null }) },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(uiSource, context, { filename: 'background-v132-ui.js' });

  const result = context.LingoFlashV132Ui.renderInlineBubble({ status: 'error' });

  assert.equal(result?.ok, false);
  assert.match(result?.error ?? '', /shadow root/i);
});
