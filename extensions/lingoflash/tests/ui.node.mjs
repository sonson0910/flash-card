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

test('renders successfully when executeScript serializes the renderer into page context', () => {
  class FakeElement {
    constructor() {
      this.children = [];
      this.style = {};
      this.attributes = {};
      this.dataset = {};
      this.isConnected = true;
    }

    setAttribute(name, value) { this.attributes[name] = String(value); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    attachShadow() { this.shadowRoot = new FakeElement(); return this.shadowRoot; }
    remove() { this.isConnected = false; }
  }

  const isolated = {
    Array,
    Math,
    Number,
    Object,
    String,
    URL,
    document: {
      documentElement: new FakeElement(),
      getElementById: () => null,
      createElement: () => new FakeElement(),
      createElementNS: (_namespace, tagName) => {
        const element = new FakeElement();
        element.tagName = tagName.toUpperCase();
        return element;
      },
    },
    innerWidth: 1280,
    innerHeight: 720,
    speechSynthesis: { speak() {}, cancel() {} },
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
  };
  isolated.globalThis = isolated;
  vm.createContext(isolated);

  const sourceContext = {};
  sourceContext.globalThis = sourceContext;
  vm.createContext(sourceContext);
  vm.runInContext(uiSource, sourceContext, { filename: 'background-ui.js' });
  const serializedRenderer = vm.runInContext(
    `(${sourceContext.LingoFlashExtensionUi.renderInlineBubble.toString()})`,
    isolated,
  );

  const result = serializedRenderer.call(isolated, { status: 'error', text: 'resilient' });

  assert.equal(result?.ok, true);
});

test('honors autoSpeak in the serialized renderer with a bounded speech rate and locale', () => {
  class FakeElement {
    constructor() { this.children = []; this.style = {}; this.dataset = {}; this.isConnected = true; }
    setAttribute() {}
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    attachShadow() { this.shadowRoot = new FakeElement(); return this.shadowRoot; }
    remove() { this.isConnected = false; }
  }
  const spoken = [];
  const isolated = {
    Array, Math, Number, Object, String, URL,
    document: { documentElement: new FakeElement(), getElementById: () => null, createElement: () => new FakeElement() },
    innerWidth: 1280, innerHeight: 720,
    speechSynthesis: { cancel() {}, speak(utterance) { spoken.push(utterance); } },
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
  };
  isolated.globalThis = isolated;
  vm.createContext(isolated);
  const sourceContext = {};
  sourceContext.globalThis = sourceContext;
  vm.createContext(sourceContext);
  vm.runInContext(uiSource, sourceContext, { filename: 'background-ui.js' });
  const renderer = vm.runInContext(`(${sourceContext.LingoFlashExtensionUi.renderInlineBubble.toString()})`, isolated);

  const result = renderer({ status: 'translated', text: 'bonjour', translation: 'xin chào', autoSpeak: true, speechLocale: 'fr', bubbleDurationMs: 0 });

  assert.equal(result?.ok, true);
  assert.equal(spoken[0]?.text, 'bonjour');
  assert.equal(spoken[0]?.lang, 'fr-FR');
  assert.equal(spoken[0]?.rate, 0.88);
});

test('explains unavailable speech support in the serialized inline bubble', () => {
  class FakeElement {
    constructor() {
      this.children = [];
      this.style = {};
      this.dataset = {};
      this.attributes = {};
      this.isConnected = true;
      this.textContent = '';
      this.disabled = false;
    }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    attachShadow() { this.shadowRoot = new FakeElement(); return this.shadowRoot; }
    remove() { this.isConnected = false; }
  }
  const isolated = {
    Array, Math, Number, Object, String, URL,
    document: {
      documentElement: new FakeElement(),
      getElementById: () => null,
      createElement: () => new FakeElement(),
      createElementNS: (_namespace, tagName) => {
        const element = new FakeElement();
        element.tagName = tagName.toUpperCase();
        return element;
      },
    },
    innerWidth: 1280,
    innerHeight: 720,
  };
  isolated.globalThis = isolated;
  vm.createContext(isolated);
  const sourceContext = {};
  sourceContext.globalThis = sourceContext;
  vm.createContext(sourceContext);
  vm.runInContext(uiSource, sourceContext, { filename: 'background-ui.js' });
  const renderer = vm.runInContext(`(${sourceContext.LingoFlashExtensionUi.renderInlineBubble.toString()})`, isolated);

  const result = renderer({ status: 'translated', text: 'bonjour', translation: 'xin chào', bubbleDurationMs: 0 });
  const collect = node => [
    node,
    ...(node.children ?? []).flatMap(collect),
    ...(node.shadowRoot ? collect(node.shadowRoot) : []),
  ];
  const nodes = collect(isolated.document.documentElement);
  const speaker = nodes.find(node => node.className === 'speak');
  const speechHelp = nodes.find(node => node.id === 'lingoflash-inline-translation-host-speech-status');

  assert.equal(result?.ok, true);
  assert.equal(speaker?.disabled, true);
  assert.equal(speaker?.attributes['aria-describedby'], 'lingoflash-inline-translation-host-speech-status');
  assert.match(speechHelp?.textContent ?? '', /không hỗ trợ phát âm/i);
});

test('renders SVG controls in the serialized inline bubble', () => {
  class FakeElement {
    constructor(tagName = '') {
      this.tagName = tagName.toUpperCase();
      this.children = [];
      this.style = {};
      this.dataset = {};
      this.attributes = {};
      this.isConnected = true;
    }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    attachShadow() { this.shadowRoot = new FakeElement(); return this.shadowRoot; }
    remove() { this.isConnected = false; }
  }
  const isolated = {
    Array, Math, Number, Object, String, URL,
    document: {
      documentElement: new FakeElement('html'),
      getElementById: () => null,
      createElement: tagName => new FakeElement(tagName),
      createElementNS: (_namespace, tagName) => new FakeElement(tagName),
    },
    innerWidth: 1280,
    innerHeight: 720,
    speechSynthesis: { speak() {}, cancel() {} },
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
  };
  isolated.globalThis = isolated;
  vm.createContext(isolated);
  const sourceContext = { globalThis: {} };
  vm.createContext(sourceContext);
  vm.runInContext(uiSource, sourceContext, { filename: 'background-ui.js' });
  const renderer = vm.runInContext(`(${sourceContext.globalThis.LingoFlashExtensionUi.renderInlineBubble.toString()})`, isolated);

  const result = renderer({ status: 'translated', text: 'resilient', translation: 'bền bỉ', bubbleDurationMs: 0 });
  const collect = node => [node, ...(node.children ?? []).flatMap(collect), ...(node.shadowRoot ? collect(node.shadowRoot) : [])];
  const nodes = collect(isolated.document.documentElement);

  assert.equal(result?.ok, true);
  assert.ok(nodes.some(node => node.tagName === 'SVG'));
});

const createSelectionCaptureContext = ({
  selectedText = 'resilient',
  blockText = 'The resilient team recovered quickly. The release stayed on schedule.',
  useSegmenter = false,
  activeInputType = null,
  selectionOffset = blockText.toLocaleLowerCase().indexOf(selectedText.toLocaleLowerCase()),
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
  const selectionStart = selectionOffset >= 0 ? selectionOffset : blockText.indexOf(selectedText);
  const selectionEnd = selectionStart + selectedText.length;
  const createRange = () => {
    const state = {
      startContainer: textNode,
      startOffset: 0,
      endContainer: textNode,
      endOffset: blockText.length,
    };
    return {
      get startContainer() { return state.startContainer; },
      get startOffset() { return state.startOffset; },
      get endContainer() { return state.endContainer; },
      get endOffset() { return state.endOffset; },
      get commonAncestorContainer() { return textNode; },
      cloneRange() {
        const clone = createRange();
        clone.setStart(state.startContainer, state.startOffset);
        clone.setEnd(state.endContainer, state.endOffset);
        return clone;
      },
      selectNodeContents() {
        state.startContainer = textNode;
        state.startOffset = 0;
        state.endContainer = textNode;
        state.endOffset = blockText.length;
      },
      setStart(container, offset) { state.startContainer = container; state.startOffset = offset; },
      setEnd(container, offset) { state.endContainer = container; state.endOffset = offset; },
      toString() {
        return textNode.textContent.slice(state.startOffset, state.endOffset);
      },
      getBoundingClientRect: () => ({ left: 10, top: 20, right: 80, bottom: 40, width: 70, height: 20 }),
    };
  };
  const range = {
    commonAncestorContainer: textNode,
    startContainer: textNode,
    startOffset: selectionStart,
    endContainer: textNode,
    endOffset: selectionEnd,
    getBoundingClientRect: () => ({ left: 10, top: 20, right: 80, bottom: 40, width: 70, height: 20 }),
    toString: () => textNode.textContent.slice(selectionStart, selectionEnd),
  };
  const context = {
    Array,
    HTMLInputElement: FakeInputElement,
    HTMLTextAreaElement: FakeTextAreaElement,
    Intl: useSegmenter ? Intl : undefined,
    document: { activeElement, createRange },
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

test('uses the selected Range occurrence when the same word appears more than once', () => {
  const blockText = 'Lead can guide a team. The pipe contains lead.';
  const selectedText = 'lead';
  const { context } = createSelectionCaptureContext({
    blockText,
    selectedText,
    selectionOffset: blockText.lastIndexOf(selectedText),
    useSegmenter: false,
  });

  const result = context.LingoFlashExtensionUi.captureSelectionFromPage();

  assert.equal(result.context, 'The pipe contains lead.');
});

test('keeps a late selection inside the bounded context window', () => {
  const prefix = 'boilerplate. '.repeat(190);
  const selectedSentence = 'The resilient team recovered quickly.';
  const blockText = `${prefix}${selectedSentence} Keep reading.`;
  const selectedOffset = blockText.indexOf('resilient');
  assert.ok(selectedOffset > 2_000);
  const { context } = createSelectionCaptureContext({
    blockText,
    selectedText: 'resilient',
    selectionOffset: selectedOffset,
    useSegmenter: false,
  });

  const result = context.LingoFlashExtensionUi.captureSelectionFromPage();

  assert.match(result.context, /resilient/);
  assert.equal(result.context, selectedSentence);
});

test('serializes captureSelectionFromPage into an independent page context', () => {
  const blockText = 'Lead can guide a team. The pipe contains lead.';
  const selectedText = 'lead';
  class FakeInputElement {}
  class FakeTextAreaElement extends FakeInputElement {}
  const paragraph = {
    tagName: 'P',
    textContent: blockText,
    hidden: false,
    parentElement: null,
    getAttribute: () => null,
  };
  const textNode = { nodeType: 3, parentElement: paragraph, textContent: blockText };
  const start = blockText.lastIndexOf(selectedText);
  const range = {
    commonAncestorContainer: textNode,
    startContainer: textNode,
    startOffset: start,
    endContainer: textNode,
    endOffset: start + selectedText.length,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 }),
    toString: () => selectedText,
  };
  const pageRange = () => {
    const state = { start: 0, end: blockText.length };
    return {
      selectNodeContents: () => { state.start = 0; state.end = blockText.length; },
      cloneRange() {
        const clone = pageRange();
        clone.setStart(textNode, state.start);
        clone.setEnd(textNode, state.end);
        return clone;
      },
      setStart: (_container, offset) => { state.start = offset; },
      setEnd: (_container, offset) => { state.end = offset; },
      toString: () => textNode.textContent.slice(state.start, state.end),
    };
  };
  const isolated = {
    Array, HTMLInputElement: FakeInputElement, HTMLTextAreaElement: FakeTextAreaElement,
    Intl, Number, String,
    document: {
      activeElement: null,
      createRange: pageRange,
    },
    getSelection: () => ({ rangeCount: 1, isCollapsed: false, getRangeAt: () => range, toString: () => selectedText }),
  };
  isolated.globalThis = isolated;
  const sourceContext = {};
  sourceContext.globalThis = sourceContext;
  vm.createContext(sourceContext);
  vm.runInContext(uiSource, sourceContext, { filename: 'background-ui.js' });
  vm.createContext(isolated);
  const capture = vm.runInContext(
    `(${sourceContext.LingoFlashExtensionUi.captureSelectionFromPage.toString()})`,
    isolated,
  );

  const result = capture.call(isolated);

  assert.equal(result.text, selectedText);
  assert.equal(result.context, 'The pipe contains lead.');
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
