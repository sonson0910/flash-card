'use strict';

(() => {
  // This file is registered dynamically by the background worker. It is not a
  // manifest content script, so the feature remains disabled until the user
  // grants access to the current site.
  const APP_ORIGIN = 'https://encoded-hangout-433912-h2.web.app';
  const HOST_ID = 'lingoflash-selection-icon-host';
  const MAX_TEXT_LENGTH = 80;
  const DEBOUNCE_MS = 100;
  const PROTECTED_HOSTS = new Set([
    'chrome.google.com',
    'chromewebstore.google.com',
    'edge.microsoft.com',
    'microsoftedge.microsoft.com',
    'addons.mozilla.org',
  ]);
  const extensionApi = globalThis.browser ?? globalThis.chrome;
  let host = null;
  let selectedText = '';
  let timer = null;

  const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();

  const isProtectedUrl = () => {
    try {
      const url = new URL(location.href);
      return (url.protocol !== 'http:' && url.protocol !== 'https:')
        || url.origin === APP_ORIGIN
        || PROTECTED_HOSTS.has(url.hostname.toLowerCase());
    } catch {
      return true;
    }
  };

  const isEditorElement = element => {
    let current = element;
    for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
      const tag = String(current.tagName || '').toUpperCase();
      if (tag === 'INPUT' && String(current.type || '').toLowerCase() === 'password') return true;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (current.isContentEditable || current.getAttribute?.('contenteditable') === 'true') return true;
      const role = String(current.getAttribute?.('role') || '').toLowerCase();
      if (role === 'textbox' || role === 'code' || role === 'combobox') return true;
    }
    return false;
  };

  const hide = () => {
    selectedText = '';
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (host) {
      host.remove();
      host = null;
    }
  };

  const position = (element, rect) => {
    const width = 38;
    const height = 38;
    const viewportWidth = Math.max(document.documentElement.clientWidth || 0, globalThis.innerWidth || 0);
    const viewportHeight = Math.max(document.documentElement.clientHeight || 0, globalThis.innerHeight || 0);
    const left = Math.min(Math.max(8, Number(rect.left) || 8), Math.max(8, viewportWidth - width - 8));
    const top = Math.min(Math.max(8, (Number(rect.bottom) || 8) + 8), Math.max(8, viewportHeight - height - 8));
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
  };

  const show = (text, rect) => {
    hide();
    selectedText = text;
    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;width:38px;height:38px;pointer-events:auto';
    const root = host.attachShadow?.({ mode: 'closed' });
    if (!root) {
      hide();
      return;
    }
    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      @keyframes sf-pop { 0% { opacity: 0; transform: scale(0.75); } 100% { opacity: 1; transform: scale(1); } }
      button {
        align-items: center; background: radial-gradient(circle at 30% 30%, #0e2b3d 0%, #07111f 100%);
        border: 1.5px solid #22d3ee; border-radius: 50%;
        box-shadow: 0 8px 24px -4px rgba(2, 6, 23, 0.75), 0 0 14px rgba(34, 211, 238, 0.35);
        color: #a5f3fc; cursor: pointer; display: flex; font: 16px/1 system-ui, sans-serif;
        height: 36px; justify-content: center; padding: 0;
        transition: transform .18s cubic-bezier(0.16, 1, 0.3, 1), box-shadow .18s ease, background .18s ease;
        width: 36px; animation: sf-pop .18s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      }
      button:hover {
        background: radial-gradient(circle at 30% 30%, #164e63 0%, #0c2333 100%);
        transform: translateY(-2px) scale(1.08);
        box-shadow: 0 10px 28px -2px rgba(2, 6, 23, 0.85), 0 0 20px rgba(34, 211, 238, 0.55);
        border-color: #67e8f9;
      }
      button:active { transform: scale(0.95); }
      button:focus-visible { outline: 2px solid #f8fafc; outline-offset: 2px; }
      button svg { width: 18px; height: 18px; fill: #22d3ee; filter: drop-shadow(0 0 4px rgba(34, 211, 238, 0.5)); }
      @media (prefers-reduced-motion: reduce) { button { animation: none; transition: none; } button:hover { transform: none; } }
    `;
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', 'Dịch và tạo flashcard bằng LingoFlash');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M13 2L3 14h9l-1 8 10-12h-9l1-8z');
    svg.append(path);
    button.append(svg);
    const submit = event => {
      if (!event.isTrusted) return;
      event.preventDefault();
      event.stopPropagation();
      const value = selectedText;
      hide();
      if (!value) return;
      try {
        void extensionApi?.runtime?.sendMessage?.({ type: 'FLOATING_SELECTION_ADD', text: value });
      } catch {}
    };
    button.addEventListener('click', submit);
    button.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        hide();
      }
      if (event.key === 'Enter' || event.key === ' ') submit(event);
    });
    root.append(style, button);
    const mount = document.documentElement || document.body;
    if (!mount) {
      hide();
      return;
    }
    mount.append(host);
    position(host, rect);
  };

  const inspectSelection = () => {
    timer = null;
    if (isProtectedUrl()) {
      hide();
      return;
    }
    const selection = globalThis.getSelection?.();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      hide();
      return;
    }
    const range = selection.getRangeAt(0);
    if (isEditorElement(range.commonAncestorContainer?.nodeType === 1
      ? range.commonAncestorContainer
      : range.commonAncestorContainer?.parentElement)) {
      hide();
      return;
    }
    const text = normalize(selection.toString());
    if (!text || text.length > MAX_TEXT_LENGTH) {
      hide();
      return;
    }
    const rect = range.getBoundingClientRect?.();
    if (!rect || (!rect.width && !rect.height)) {
      hide();
      return;
    }
    show(text, rect);
  };

  const schedule = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(inspectSelection, DEBOUNCE_MS);
  };

  const teardown = () => {
    hide();
    document.removeEventListener('selectionchange', schedule, true);
    document.removeEventListener('pointerup', schedule, true);
    document.removeEventListener('keydown', hideOnEscape, true);
    globalThis.removeEventListener('scroll', hide, true);
    globalThis.removeEventListener('resize', hide, true);
    extensionApi?.runtime?.onMessage?.removeListener?.(onMessage);
  };

  const onMessage = message => {
    if (message?.type === 'FLOATING_SELECTION_DISABLED') teardown();
  };

  const hideOnEscape = event => {
    if (event.key === 'Escape') hide();
  };

  document.addEventListener('selectionchange', schedule, true);
  document.addEventListener('pointerup', schedule, true);
  document.addEventListener('keydown', hideOnEscape, true);
  globalThis.addEventListener('scroll', hide, true);
  globalThis.addEventListener('resize', hide, true);
  extensionApi?.runtime?.onMessage?.addListener?.(onMessage);
})();
