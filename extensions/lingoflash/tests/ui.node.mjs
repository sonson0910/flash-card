import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const uiSource = await readFile(new URL('../background-ui.js', import.meta.url), 'utf8');
const coreSource = await readFile(new URL('../background-core.js', import.meta.url), 'utf8');

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

test('provides manual speech controls without autoplay', () => {
  assert.match(uiSource, /speechSynthesis/);
  assert.match(uiSource, /SpeechSynthesisUtterance/);
  assert.match(uiSource, /Nghe phát âm/);
  assert.match(uiSource, /payload\.exampleSentence/);
  assert.doesNotMatch(uiSource, /speechSynthesis\.speak\([^)]*\)\s*;\s*return/);
});

test('reports failure when an existing host element has no shadow root', () => {
  const context = {
    document: { getElementById: () => ({ shadowRoot: null }) },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(uiSource, context, { filename: 'background-ui.js' });

  const result = context.LingoFlashExtensionUi.renderInlineBubble({ status: 'error' });

  assert.equal(result?.ok, false);
  assert.match(result?.error ?? '', /shadow root/i);
});

const createSelectionCaptureContext = ({
  selectedText = 'resilient',
  blockText = 'The resilient team recovered quickly. The release stayed on schedule.',
  useSegmenter = false,
  activeInputType = null,
} = {}) => {
  class FakeElement {
    constructor(tagName, textContent, parentElement = null) {
      this.tagName = tagName;
      this.textContent = textContent;
      this.parentElement = parentElement;
      this.hidden = false;
      this.attributes = new Map();
    }

    getAttribute(name) { return this.attributes.get(name) ?? null; }

    hasAttribute(name) { return this.attributes.has(name); }

    closest() { return null; }

    getBoundingClientRect() {
      return { left: 10, top: 20, right: 80, bottom: 40, width: 70, height: 20 };
    }
  }

  class FakeInputElement extends FakeElement {
    constructor(value, type = 'text') {
      super('INPUT', value);
      this.value = value;
      this.type = type;
      this.selectionStart = 0;
      this.selectionEnd = value.length;
    }
  }

  class FakeTextAreaElement extends FakeInputElement {
    constructor(value) {
      super(value);
      this.tagName = 'TEXTAREA';
    }
  }

  const paragraph = new FakeElement('P', blockText);
  const activeElement = activeInputType ? new FakeInputElement('secret', activeInputType) : null;
  if (activeElement) {
    activeElement.selectionStart = 0;
    activeElement.selectionEnd = activeElement.value.length;
  }
  const textNode = { nodeType: 3, parentElement: paragraph, textContent: blockText };
  const range = {
    commonAncestorContainer: textNode,
    getBoundingClientRect: () => ({ left: 10, top: 20, right: 80, bottom: 40, width: 70, height: 20 }),
  };
  const context = {
    Array,
    HTMLInputElement: FakeInputElement,
    HTMLTextAreaElement: FakeTextAreaElement,
    Intl: useSegmenter ? Intl : undefined,
    document: { activeElement },
    getSelection: () => ({ rangeCount: 1, isCollapsed: false, getRangeAt: () => range, toString: () => selectedText }),
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(uiSource, context, { filename: 'background-ui.js' });
  return { context, paragraph };
};

test('captures one bounded sentence around a selected word', () => {
  const { context } = createSelectionCaptureContext({ useSegmenter: true });

  const result = context.LingoFlashExtensionUi.captureSelectionFromPage();

  assert.equal(result.text, 'resilient');
  assert.equal(result.context, 'The resilient team recovered quickly.');
  assert.ok(result.context.length <= 500);
});

test('falls back to punctuation boundaries when Intl.Segmenter is unavailable', () => {
  const { context } = createSelectionCaptureContext({
    useSegmenter: false,
    blockText: 'A short lead. The resilient team recovered quickly! Keep reading?',
  });

  const result = context.LingoFlashExtensionUi.captureSelectionFromPage();

  assert.equal(result.context, 'The resilient team recovered quickly!');
});

test('does not capture selections from password or hidden inputs', () => {
  const { context } = createSelectionCaptureContext({ activeInputType: 'password' });

  const result = context.LingoFlashExtensionUi.captureSelectionFromPage();

  assert.equal(result.text, '');
  assert.equal(result.context, '');
});

test('does not capture a selection inside a hidden ancestor block', () => {
  const { context, paragraph } = createSelectionCaptureContext();
  paragraph.hidden = true;

  const result = context.LingoFlashExtensionUi.captureSelectionFromPage();

  assert.equal(result.text, '');
  assert.equal(result.context, '');
});

test('caps context scanning and never returns more than 500 characters', () => {
  const longSentence = `The resilient ${'team '.repeat(500)}finished.`;
  const { context } = createSelectionCaptureContext({ blockText: longSentence });

  const result = context.LingoFlashExtensionUi.captureSelectionFromPage();

  assert.equal(result.text, 'resilient');
  assert.ok(result.context.length <= 500);
});
