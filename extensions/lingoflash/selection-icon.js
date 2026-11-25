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
  // Self-contained: this file is registered directly as a content script (not
  // serialized), so it keeps persistent access to chrome.i18n; falls back to
  // the same literal SonFlash copy outside a real extension runtime.
  const t = (name, substitutions, fallback) => {
    try {
      const resolved = extensionApi?.i18n?.getMessage(name, substitutions);
      return typeof resolved === 'string' && resolved ? resolved : fallback;
    } catch { return fallback; }
  };
  let host = null;
  let selectedText = '';
  let timer = null;
  // The icon follows the extension's saved look; it reads only SonFlash's own
  // settings entry and keeps the Classic/system default when that is unavailable.
  const SETTINGS_STORAGE_KEY = 'lingoflash_extension_settings';
  let themeFamily = 'classic';
  let colorScheme = 'system';
  const applyStoredTheme = settings => {
    if (!settings || typeof settings !== 'object') return;
    themeFamily = settings.themeFamily === 'crystal' ? 'crystal' : 'classic';
    colorScheme = settings.colorScheme === 'dark' || settings.colorScheme === 'light' ? settings.colorScheme : 'system';
  };
  const readStoredTheme = () => {
    try {
      const area = extensionApi?.storage?.sync ?? extensionApi?.storage?.local;
      if (typeof area?.get !== 'function') return;
      const done = values => applyStoredTheme(values?.[SETTINGS_STORAGE_KEY]);
      if (globalThis.browser?.storage) void area.get(SETTINGS_STORAGE_KEY).then(done, () => {});
      else area.get(SETTINGS_STORAGE_KEY, done);
    } catch {}
  };
  const onStorageChanged = changes => {
    if (changes?.[SETTINGS_STORAGE_KEY]) applyStoredTheme(changes[SETTINGS_STORAGE_KEY].newValue);
  };
  const resolvedScheme = () => {
    if (colorScheme !== 'system') return colorScheme;
    try { return globalThis.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light'; } catch { return 'light'; }
  };

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
    const family = themeFamily;
    const scheme = resolvedScheme();
    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      @keyframes sf-pop { 0% { opacity: 0; transform: scale(0.75); } 100% { opacity: 1; transform: scale(1); } }
      button {
        --icon-bg: linear-gradient(145deg, #7ee6fa, #28d3f4 45%, #966cd7);
        --icon-text: #04141c;
        --icon-shadow: 0 6px 16px -4px rgb(40 211 244 / 0.7);
        --icon-focus: #7ee6fa;
        align-items: center; background: var(--icon-bg); border: 0; border-radius: 50%;
        box-shadow: var(--icon-shadow); color: var(--icon-text); cursor: pointer; display: flex;
        height: 34px; justify-content: center; margin: 2px; padding: 0; width: 34px;
        transition: transform .18s cubic-bezier(0.16, 1, 0.3, 1), box-shadow .18s ease;
        animation: sf-pop .18s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      }
      button[data-scheme="light"] { --icon-bg: #1d1a16; --icon-text: #fbf6ec; --icon-shadow: 0 6px 14px -6px rgb(29 26 22 / 0.7); --icon-focus: #b4461a; }
      button[data-family="crystal"] {
        --icon-bg: linear-gradient(145deg, #1a1f30, #07090f); --icon-focus: #5ef2ff;
        border-radius: 0; box-shadow: none; height: 38px; margin: 0; padding: 7px; width: 38px;
        clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%);
        filter: drop-shadow(0 6px 10px rgb(255 42 77 / 0.5));
      }
      button[data-family="crystal"][data-scheme="light"] { --icon-bg: linear-gradient(145deg, #ffffff, #d6ecff); --icon-focus: #0a7d99; }
      /* The appear animation ends on the resting look, so Classic lets go of it and the press can move the icon. */
      button:not([data-family="crystal"]) { animation-fill-mode: backwards; transition: transform 180ms cubic-bezier(.16, 1, .3, 1), filter 180ms ease; }
      button:not([data-family="crystal"])[data-scheme="light"] { transition: transform 160ms cubic-bezier(.16, 1, .3, 1), filter 160ms ease; }
      button[data-family="crystal"]:hover { transform: translateY(-2px) scale(1.06); }
      @media (hover: hover) and (pointer: fine) {
        button:not([data-family="crystal"]):hover { transform: translateY(-2px); filter: brightness(1.08) drop-shadow(0 10px 18px rgb(40 211 244 / .35)); }
        button:not([data-family="crystal"])[data-scheme="light"]:hover { transform: translateY(-2px); filter: drop-shadow(0 8px 8px rgb(60 40 20 / .2)); }
      }
      button[data-family="crystal"]:active { transform: scale(0.95); }
      button:not([data-family="crystal"]):active { transform: translateY(0) scale(.97); filter: brightness(.98); }
      button:not([data-family="crystal"])[data-scheme="light"]:active { transform: translateY(1px) scale(.98); filter: none; }
      button:focus-visible { outline: 2px solid var(--icon-focus); outline-offset: 2px; }
      button svg { display: block; height: 100%; width: 100%; }
      button text { fill: currentColor; font-family: Fraunces, Georgia, 'Times New Roman', serif; font-size: 17px; font-style: italic; }
      @media (prefers-reduced-motion: reduce) { button { animation: none; transition: none; } button:hover { transform: none; } button:not([data-family="crystal"]):is(:hover, :active) { transform: none; filter: none; } }
    `;
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', t('selectionIconAriaLabel', undefined, 'Dịch và tạo flashcard bằng SonFlash'));
    button.setAttribute('data-family', family);
    button.setAttribute('data-scheme', scheme);
    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('aria-hidden', 'true');
    if (family === 'crystal') {
      // Crystal Star's five-point faceted star, alternating light and deep facets.
      svg.setAttribute('viewBox', '0 0 100 100');
      const points = [
        ['50.0,52.0 38.2,35.7 50.0,4.0', '#ff5470'], ['50.0,52.0 50.0,4.0 61.8,35.7', '#7a0820'],
        ['50.0,52.0 61.8,35.7 95.7,37.2', '#ff5470'], ['50.0,52.0 95.7,37.2 69.2,58.2', '#7a0820'],
        ['50.0,52.0 69.2,58.2 78.2,90.8', '#ff5470'], ['50.0,52.0 78.2,90.8 50.0,72.2', '#7a0820'],
        ['50.0,52.0 50.0,72.2 21.8,90.8', '#ff5470'], ['50.0,52.0 21.8,90.8 30.8,58.2', '#7a0820'],
        ['50.0,52.0 30.8,58.2 4.3,37.2', '#ff5470'], ['50.0,52.0 4.3,37.2 38.2,35.7', '#7a0820'],
      ];
      for (const [value, fill] of points) {
        const polygon = document.createElementNS(svgNs, 'polygon');
        polygon.setAttribute('points', value);
        polygon.setAttribute('fill', fill);
        svg.append(polygon);
      }
    } else {
      // Classic shows the SonFlash "S" monogram.
      svg.setAttribute('viewBox', '0 0 34 34');
      const letter = document.createElementNS(svgNs, 'text');
      letter.setAttribute('x', '17');
      letter.setAttribute('y', '23');
      letter.setAttribute('text-anchor', 'middle');
      letter.textContent = 'S';
      svg.append(letter);
    }
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
    extensionApi?.storage?.onChanged?.removeListener?.(onStorageChanged);
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
  extensionApi?.storage?.onChanged?.addListener?.(onStorageChanged);
  readStoredTheme();
})();
