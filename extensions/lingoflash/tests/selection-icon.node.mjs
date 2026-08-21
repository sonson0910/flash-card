import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../selection-icon.js', import.meta.url), 'utf8');

test('selection icon is an opt-in, bounded, page-local control', () => {
  assert.match(source, /MAX_TEXT_LENGTH = 80/);
  assert.match(source, /selectionchange/);
  assert.match(source, /pointerup/);
  assert.match(source, /setTimeout\(inspectSelection, DEBOUNCE_MS\)/);
  assert.match(source, /attachShadow\?\.\(\{ mode: 'closed' \}\)/);
  assert.match(source, /createElementNS\(['"]http:\/\/www\.w3\.org\/2000\/svg['"], ['"]svg['"]\)/);
  assert.doesNotMatch(source, /textContent\s*=\s*['"]⚡['"]/);
  assert.match(source, /if \(!event\.isTrusted\) return/);
  assert.match(source, /FLOATING_SELECTION_ADD/);
  assert.match(source, /contenteditable/);
  assert.match(source, /toLowerCase\(\) === 'password'/);
  assert.match(source, /key === 'Escape'/);
  assert.match(source, /prefers-reduced-motion/);
  assert.match(source, /scroll/);
  assert.match(source, /resize/);
});

test('selection icon does not send selection text from event observers', () => {
  const observerSection = source.slice(0, source.indexOf('const submit'));
  assert.doesNotMatch(observerSection, /sendMessage/);
});

const createEventTarget = () => {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      const current = listeners.get(type) ?? [];
      current.push(listener);
      listeners.set(type, current);
    },
    removeEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) ?? []).filter(candidate => candidate !== listener));
    },
    dispatch(type, event = {}) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener(event);
    },
    listeners,
  };
};

const createIconContext = ({ url = 'https://example.com/article', editor = false } = {}) => {
  const documentEvents = createEventTarget();
  const windowEvents = createEventTarget();
  const runtimeMessages = createEventTarget();
  runtimeMessages.addListener = listener => runtimeMessages.addEventListener('message', listener);
  runtimeMessages.removeListener = listener => runtimeMessages.removeEventListener('message', listener);
  const sentMessages = [];
  let selectionText = 'resilient';
  const range = {
    commonAncestorContainer: { nodeType: 3, parentElement: { tagName: editor ? 'INPUT' : 'P' } },
    getBoundingClientRect: () => ({ left: 10, bottom: 20, width: 30, height: 12 }),
  };
  const selection = {
    rangeCount: 1,
    isCollapsed: false,
    getRangeAt: () => range,
    toString: () => selectionText,
  };
  class FakeRoot {
    constructor(host) {
      this.host = host;
      this.children = [];
    }
    append(...children) {
      this.children.push(...children);
    }
  }
  class FakeElement {
    constructor(tagName) {
      this.tagName = tagName.toUpperCase();
      this.children = [];
      this.parentElement = null;
      this.style = {};
      this.attributes = new Map();
      this.events = createEventTarget();
      this.clientWidth = 1024;
      this.clientHeight = 768;
    }
    append(...children) {
      for (const child of children) {
        child.parentElement = this;
        this.children.push(child);
      }
    }
    remove() {
      this.parentElement?.children.splice(this.parentElement.children.indexOf(this), 1);
      this.parentElement = null;
    }
    attachShadow({ mode }) {
      this.shadowMode = mode;
      this.shadowRoot = null;
      this._shadowRoot = new FakeRoot(this);
      return this._shadowRoot;
    }
    addEventListener(...args) { this.events.addEventListener(...args); }
    removeEventListener(...args) { this.events.removeEventListener(...args); }
    dispatchEvent(event) {
      event.target = this;
      this.events.dispatch(event.type, event);
    }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
  }
  const documentElement = new FakeElement('html');
  const document = {
    documentElement,
    body: documentElement,
    createElement: tagName => new FakeElement(tagName),
    createElementNS: (_namespace, tagName) => new FakeElement(tagName),
    addEventListener: (...args) => documentEvents.addEventListener(...args),
    removeEventListener: (...args) => documentEvents.removeEventListener(...args),
  };
  const context = {
    URL,
    Map,
    String,
    Math,
    Number,
    Object,
    Promise,
    setTimeout,
    clearTimeout,
    document,
    location: { href: url },
    getSelection: () => selection,
    innerWidth: 1024,
    innerHeight: 768,
    chrome: {
      runtime: {
        sendMessage: message => { sentMessages.push(message); },
        onMessage: runtimeMessages,
      },
    },
    addEventListener: (...args) => windowEvents.addEventListener(...args),
    removeEventListener: (...args) => windowEvents.removeEventListener(...args),
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'selection-icon.js' });
  const flushSelection = async () => {
    documentEvents.dispatch('pointerup', { isTrusted: true });
    await new Promise(resolve => setTimeout(resolve, 125));
    return documentElement.children[0] ?? null;
  };
  return {
    context,
    documentElement,
    documentEvents,
    runtimeMessages,
    sentMessages,
    selection,
    flushSelection,
  };
};

const trustedEvent = type => ({
  type,
  isTrusted: true,
  preventDefault() {},
  stopPropagation() {},
});

test('blocks synthetic activation, permits one trusted activation, and hides after activation', async () => {
  const harness = createIconContext();
  const host = await harness.flushSelection();
  assert.ok(host);
  assert.equal(host.shadowMode, 'closed');
  const button = host._shadowRoot.children.find(child => child.tagName === 'BUTTON');
  assert.ok(button);
  assert.ok(button.children.some(child => child.tagName === 'SVG'));

  button.dispatchEvent({ ...trustedEvent('click'), isTrusted: false });
  assert.deepEqual(harness.sentMessages, []);
  assert.equal(harness.documentElement.children.includes(host), true);

  button.dispatchEvent(trustedEvent('click'));
  assert.equal(harness.sentMessages.length, 1);
  assert.equal(harness.sentMessages[0].type, 'FLOATING_SELECTION_ADD');
  assert.equal(harness.sentMessages[0].text, 'resilient');
  assert.equal(harness.documentElement.children.includes(host), false);
  button.dispatchEvent(trustedEvent('click'));
  assert.equal(harness.sentMessages.length, 1);
});

test('does not show on editor selections, protected HTTPS pages, or after revoke teardown', async () => {
  const editor = createIconContext({ editor: true });
  assert.equal(await editor.flushSelection(), null);

  const store = createIconContext({ url: 'https://chromewebstore.google.com/detail/lingoflash' });
  assert.equal(await store.flushSelection(), null);

  const revoked = createIconContext();
  const host = await revoked.flushSelection();
  assert.ok(host);
  assert.equal(revoked.runtimeMessages.listeners.get('message')?.length, 1);
  revoked.runtimeMessages.dispatch('message', { type: 'FLOATING_SELECTION_DISABLED' });
  assert.equal(revoked.documentElement.children.includes(host), false);
  revoked.documentEvents.dispatch('pointerup', { isTrusted: true });
  await new Promise(resolve => setTimeout(resolve, 125));
  assert.equal(revoked.documentElement.children.length, 0);
});
