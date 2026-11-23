import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { createI18nMock } from './i18n-test-helper.mjs';

const uiSource = await readFile(new URL('../background-ui.js', import.meta.url), 'utf8');
const coreSource = await readFile(new URL('../background-core.js', import.meta.url), 'utf8');

test('keeps complete card example fields in the inline result path', () => {
  assert.match(coreSource, /exampleSentence/);
  assert.match(coreSource, /exampleTranslation/);
  assert.match(uiSource, /exampleSentence/);
  assert.match(uiSource, /exampleTranslation/);
  assert.match(uiSource, /payload\.aiGenerated/);
  assert.match(uiSource, /Nội dung do AI tạo, có thể sai\. Hãy kiểm tra nghĩa\./);
});

test('provides an accessible live status and auth link in the inline bubble', () => {
  assert.match(uiSource, /setAttribute\(['"]role['"],\s*['"]status['"]\)/);
  assert.match(uiSource, /aria-live/);
  assert.match(uiSource, /loginUrl/);
  assert.match(uiSource, /prefers-reduced-motion/);
});

test('keeps long inline results inside the viewport with measured positioning and scrolling', () => {
  assert.match(uiSource, /max-height:calc\(100vh - 24px\)/);
  assert.match(uiSource, /overflow:auto/);
  assert.match(uiSource, /getBoundingClientRect/);
  assert.doesNotMatch(uiSource, /vh-190/);
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

const renderBubbleForToneAssertions = (payload, locale) => {
  class FakeElement {
    constructor(tagName = '') {
      this.tagName = tagName.toUpperCase();
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
  if (locale) isolated.chrome = { i18n: createI18nMock(locale) };
  isolated.globalThis = isolated;
  vm.createContext(isolated);
  const sourceContext = { globalThis: {} };
  vm.createContext(sourceContext);
  vm.runInContext(uiSource, sourceContext, { filename: 'background-ui.js' });
  const renderer = vm.runInContext(`(${sourceContext.globalThis.LingoFlashExtensionUi.renderInlineBubble.toString()})`, isolated);

  const result = renderer({ bubbleDurationMs: 0, ...payload });
  const collect = node => [node, ...(node.children ?? []).flatMap(collect), ...(node.shadowRoot ? collect(node.shadowRoot) : [])];
  const nodes = collect(isolated.document.documentElement);
  return { result, nodes };
};

test('themes the bubble from the saved family and scheme, resolving system to the page preference', () => {
  const crystal = renderBubbleForToneAssertions({ status: 'created', text: 'resilient', translation: 'bền bỉ', themeFamily: 'crystal', colorScheme: 'dark' });
  const crystalFrame = crystal.nodes.find(node => node.className === 'frame');
  assert.equal(crystal.result?.ok, true);
  assert.equal(crystalFrame?.dataset?.family, 'crystal');
  assert.equal(crystalFrame?.dataset?.scheme, 'dark');

  const system = renderBubbleForToneAssertions({ status: 'created', text: 'resilient', translation: 'bền bỉ', colorScheme: 'system' });
  const systemFrame = system.nodes.find(node => node.className === 'frame');
  assert.equal(systemFrame?.dataset?.family, 'classic');
  assert.equal(systemFrame?.dataset?.scheme, 'light');
});

test('draws the Crystal Star wings and footer Lumi from inlined art, never from an extension file', () => {
  const crystal = renderBubbleForToneAssertions({ status: 'created', text: 'resilient', translation: 'bền bỉ', themeFamily: 'crystal', colorScheme: 'dark' });
  const wings = crystal.nodes.find(node => node.className === 'wings');
  const lumi = crystal.nodes.find(node => node.className === 'lumi');
  const lumiImage = lumi?.children.find(node => node.tagName === 'IMG');
  assert.equal(crystal.result?.ok, true);
  assert.equal(wings?.attributes['aria-hidden'], 'true');
  assert.ok(wings?.children[0]?.tagName === 'SVG' && wings.children[0].children.some(node => node.tagName === 'POLYGON'));
  assert.equal(lumi?.attributes['aria-hidden'], 'true');
  assert.match(lumiImage?.src ?? '', /^data:image\/webp;base64,/);
  assert.equal(lumiImage?.alt, '');
  assert.equal(typeof lumiImage?.onerror, 'function');
  assert.doesNotMatch(uiSource, /chrome-extension:|runtime\.getURL|assets\/lumi/);

  const classic = renderBubbleForToneAssertions({ status: 'created', text: 'resilient', translation: 'bền bỉ', themeFamily: 'classic', colorScheme: 'dark' });
  assert.equal(classic.nodes.some(node => node.className === 'wings' || node.className === 'lumi'), false);
});

test('gives a duplicate (existing) card a distinct amber badge tone, never the created tone', () => {
  const { result, nodes } = renderBubbleForToneAssertions({ status: 'existing', text: 'resilient', translation: 'bền bỉ' });
  const badge = nodes.find(node => node.className === 'ok');

  assert.equal(result?.ok, true);
  assert.equal(badge?.dataset?.tone, 'existing');
  assert.match(badge?.textContent ?? '', /Đã có trong thư viện/);
});

test('does not tag a freshly created card with the duplicate tone', () => {
  const { result, nodes } = renderBubbleForToneAssertions({ status: 'created', text: 'resilient', translation: 'bền bỉ' });
  const badge = nodes.find(node => node.className === 'ok');

  assert.equal(result?.ok, true);
  assert.equal(badge?.dataset?.tone, undefined);
  assert.match(badge?.textContent ?? '', /Đã thêm vào thư viện/);
});

test('classifies an AI-quota error message as a quota tone with an upgrade action, not a retry button', () => {
  const { result, nodes } = renderBubbleForToneAssertions({
    status: 'error',
    text: 'resilient',
    message: 'Dịch vụ AI đã hết hạn mức. Từ đã chọn vẫn được giữ lại; hãy thử lại sau.',
    retryId: 'job_quota_1',
  });
  const errorNode = nodes.find(node => node.className === 'err');
  const note = nodes.find(node => node.className === 'quota-note');
  const buttons = nodes.filter(node => node.tagName === 'BUTTON' && node.className === 'speak');

  assert.equal(result?.ok, true);
  assert.equal(errorNode?.dataset?.tone, 'quota');
  assert.match(note?.textContent ?? '', /Dịch nhanh vẫn miễn phí/);
  assert.ok(buttons.some(button => /Nâng cấp Pro/.test(button.textContent ?? '')));
  assert.equal(buttons.some(button => /Thử lại từ này/.test(button.textContent ?? '')), false);
});

test('shows the quota state and catalog text for a quota reason, whatever language the message is in', () => {
  for (const locale of ['en', 'vi']) {
    const { nodes } = renderBubbleForToneAssertions({
      status: 'error', text: 'resilient', reason: 'quota-ai-cards', message: 'any english text', retryId: 'job_quota_2',
    }, locale);
    const errorNode = nodes.find(node => node.className === 'err');
    const note = nodes.find(node => node.className === 'quota-note');
    const catalog = createI18nMock(locale);
    assert.equal(errorNode?.dataset?.tone, 'quota');
    assert.equal(errorNode?.textContent, catalog.getMessage('captureReason_quota_ai_cards'));
    assert.equal(note?.textContent, catalog.getMessage('bubbleQuotaNote'));
    assert.notEqual(errorNode?.textContent, 'any english text');
  }
});

test('shows catalog text for a non-quota reason and keeps the message for an unknown or missing reason', () => {
  const english = createI18nMock('en');
  const byReason = renderBubbleForToneAssertions({
    status: 'error', text: 'resilient', reason: 'deck-missing', message: 'Deck “X” không còn tồn tại.', retryId: 'job_reason_1',
  }, 'en');
  const reasonNode = byReason.nodes.find(node => node.className === 'err');
  assert.equal(reasonNode?.textContent, english.getMessage('captureReason_deck_missing'));
  assert.equal(reasonNode?.dataset?.tone, undefined);

  const unknown = renderBubbleForToneAssertions({
    status: 'error', text: 'resilient', reason: 'brand-new-reason', message: 'Fallback message', retryId: 'job_reason_2',
  }, 'en');
  assert.equal(unknown.nodes.find(node => node.className === 'err')?.textContent, 'Fallback message');
  const legacy = renderBubbleForToneAssertions({ status: 'error', text: 'resilient', message: 'Đã hết hạn mức AI.' }, 'en');
  assert.equal(legacy.nodes.find(node => node.className === 'err')?.dataset?.tone, 'quota');
});

test('keeps the retry button, and no quota tone, for a non-quota error even with a retryId', () => {
  const { result, nodes } = renderBubbleForToneAssertions({
    status: 'error',
    text: 'resilient',
    message: 'Dịch vụ AI đang bận. Thử lại sau.',
    retryId: 'job_generic_1',
  });
  const errorNode = nodes.find(node => node.className === 'err');
  const buttons = nodes.filter(node => node.tagName === 'BUTTON' && node.className === 'speak');

  assert.equal(result?.ok, true);
  assert.equal(errorNode?.dataset?.tone, undefined);
  assert.ok(buttons.some(button => /Thử lại từ này/.test(button.textContent ?? '')));
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

const renderLanguageBubble = payload => {
  class FakeNode {
    constructor(tagName = '') {
      this.tagName = tagName.toUpperCase();
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
    attachShadow() { this.shadowRoot = new FakeNode(); return this.shadowRoot; }
    remove() { this.isConnected = false; }
  }
  const sent = [];
  const isolated = {
    Array, Intl, Math, Number, Object, String, URL,
    document: {
      documentElement: new FakeNode('html'),
      getElementById: () => null,
      createElement: tagName => new FakeNode(tagName),
      createElementNS: (_namespace, tagName) => new FakeNode(tagName),
      createTextNode: text => Object.assign(new FakeNode('#text'), { textContent: String(text) }),
    },
    chrome: { runtime: { sendMessage: (message, callback) => { sent.push(message); callback?.({ ok: true }); } } },
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
  const result = renderer({ bubbleDurationMs: 0, ...payload });
  const collect = node => [node, ...(node.children ?? []).flatMap(collect), ...(node.shadowRoot ? collect(node.shadowRoot) : [])];
  const nodes = collect(isolated.document.documentElement);
  const text = node => node.children.length ? node.children.map(text).join('') : node.textContent;
  return { result, nodes, sent, text };
};

const koreanTranslation = {
  status: 'translated', text: '결정', translation: 'quyết định', courseLanguage: 'ko', nativeLanguage: 'vi',
  sourceLanguage: 'ko', translationLanguage: 'vi', pageLanguage: 'ko', romanization: 'gyeoljeong',
  context: '중앙은행이 기준금리를 동결하기로 결정하면서 금융시장은 일단 안도하는 분위기다.',
};

test('shows a language-course translation with its language, reading, page context and course', () => {
  const { result, nodes, text } = renderLanguageBubble({ ...koreanTranslation, saveId: 'save_1' });
  const word = nodes.find(node => node.className === 's');
  const languageLine = nodes.find(node => node.className === 'lang-line');
  const reading = nodes.find(node => node.className === 'p');
  const context = nodes.find(node => node.className === 'q');
  const save = nodes.find(node => node.dataset?.role === 'save');
  const meanings = nodes.find(node => node.className === 'n');

  assert.equal(result?.ok, true);
  assert.equal(word?.attributes.lang, 'ko');
  assert.equal(text(languageLine), 'Trang bằng 한국어 · tự nhận diện');
  assert.equal(reading?.textContent, 'gyeoljeong');
  assert.equal(context?.children.find(node => node.tagName === 'STRONG')?.textContent, '결정');
  assert.equal(text(context), koreanTranslation.context);
  assert.equal(text(save), 'Lưu vào 한국어');
  assert.equal(text(meanings), 'Nghĩa bằngTiếng Việt');
  assert.equal(nodes.some(node => node.className === 'ok'), false);
});

test('sends the in-page save only for a real click, with the one-time id and never the word', () => {
  const { nodes, sent } = renderLanguageBubble({ ...koreanTranslation, saveId: 'save_1' });
  const save = nodes.find(node => node.dataset?.role === 'save');

  save.onclick({ isTrusted: false });
  assert.deepEqual(sent, []);
  save.onclick({ isTrusted: true });
  assert.equal(sent.length, 1);
  assert.equal(JSON.stringify(sent[0]), JSON.stringify({ type: 'INLINE_SELECTION_ADD', id: 'save_1' }));
});

test('keeps the plain translated badge when the background offers no save', () => {
  const { nodes, text } = renderLanguageBubble({ ...koreanTranslation, sourceLanguage: 'fr', pageLanguage: '' });
  assert.equal(nodes.some(node => node.dataset?.role === 'save'), false);
  assert.equal(nodes.find(node => node.className === 'ok')?.textContent, 'Chỉ dịch • không lưu • không dùng quota AI');
  assert.equal(text(nodes.find(node => node.className === 'lang-line')), 'Đoạn chọn bằng Français · tự nhận diện');

  const english = renderLanguageBubble({ status: 'translated', text: 'immediate', translation: 'ngay lập tức', courseLanguage: 'en', nativeLanguage: 'vi', sourceLanguage: 'en', saveId: 'save_2' });
  assert.equal(english.text(english.nodes.find(node => node.dataset?.role === 'save')), 'Lưu flashcard');
  assert.equal(english.nodes.find(node => node.className === 'meta')?.children[0]?.textContent, '1 lượt AI');
  assert.equal(english.nodes.some(node => node.className === 'lang-line'), false);

  const quoted = renderLanguageBubble({
    status: 'translated', text: 'immediate', translation: 'ngay lập tức',
    context: 'Residents and neighbourhood groups demanded an immediate response from the council, and the mayor promised a plan.',
  });
  assert.equal(quoted.text(quoted.nodes.find(node => node.className === 'q')), '…groups demanded an immediate response from the…');
});

test('writes the bubble mode chip from the locale catalog, not from worker text', () => {
  for (const [locale, mode, key] of [
    ['en', 'translate-free', 'bubbleModeTranslateFree'],
    ['en', 'translate-google', 'bubbleModeTranslateGoogle'],
    ['en', 'save', 'bubbleModeSave'],
    ['vi', 'save-ai', 'bubbleModeSaveAi'],
  ]) {
    const { nodes } = renderBubbleForToneAssertions({ status: 'error', text: 'resilient', mode }, locale);
    const chip = nodes.find(node => node.className === 'm');
    assert.equal(chip?.textContent, createI18nMock(locale).getMessage(key), `${locale} ${mode}`);
    assert.ok(chip?.textContent);
  }
  const english = renderBubbleForToneAssertions({ status: 'error', text: 'resilient', mode: 'save-ai' }, 'en').nodes.find(node => node.className === 'm');
  assert.doesNotMatch(english?.textContent ?? '', /[À-ỹ]/);
});
