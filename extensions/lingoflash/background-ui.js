'use strict';

(() => {
  const MAX_CONTEXT_SCAN_LENGTH = 2_000;
  const MAX_CONTEXT_LENGTH = 500;
  const CONTEXT_BLOCK_TAGS = [
    'ADDRESS', 'ARTICLE', 'BLOCKQUOTE', 'DD', 'DIV', 'FIGCAPTION', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'LI', 'MAIN', 'P', 'PRE', 'SECTION', 'TD', 'TH',
  ];

  const normalizeContextText = value => String(value ?? '').replace(/\s+/g, ' ').trim();

  const isHiddenElement = element => {
    if (!element || typeof element !== 'object') return false;
    if (element.hidden === true || element.getAttribute?.('aria-hidden') === 'true') return true;
    const tagName = String(element.tagName || '').toUpperCase();
    if (tagName === 'SCRIPT' || tagName === 'STYLE' || tagName === 'NOSCRIPT' || tagName === 'TEMPLATE') return true;
    if (tagName === 'INPUT' && ['password', 'hidden'].includes(String(element.type || '').toLowerCase())) return true;
    try {
      const style = globalThis.getComputedStyle?.(element);
      if (style && (style.display === 'none' || style.visibility === 'hidden')) return true;
    } catch {
      // Some protected pages do not expose computed styles to injected code.
    }
    return false;
  };

  const elementForNode = node => node?.nodeType === 1 ? node : node?.parentElement;

  const hasHiddenAncestor = node => {
    let element = elementForNode(node);
    for (let depth = 0; element && depth < 16; depth += 1) {
      if (isHiddenElement(element)) return true;
      const tagName = String(element.tagName || '').toUpperCase();
      if (tagName === 'BODY' || tagName === 'HTML') break;
      element = element.parentElement;
    }
    return false;
  };

  const findContextBlock = node => {
    let element = elementForNode(node);
    let block = null;
    for (let depth = 0; element && depth < 16; depth += 1) {
      if (isHiddenElement(element)) return null;
      const tagName = String(element.tagName || '').toUpperCase();
      if (!block && CONTEXT_BLOCK_TAGS.includes(tagName)) block = element;
      if (tagName === 'BODY' || tagName === 'HTML') break;
      element = element.parentElement;
    }
    return block;
  };

  const sentenceSegments = text => {
    try {
      const Segmenter = globalThis.Intl?.Segmenter;
      if (typeof Segmenter === 'function') {
        const segmenter = new Segmenter(undefined, { granularity: 'sentence' });
        return Array.from(segmenter.segment(text), value => value.segment);
      }
    } catch {
      // Fall through to punctuation segmentation below.
    }
    const segments = [];
    const pattern = /[^.!?…\n]+(?:[.!?…]+|$)/g;
    let match;
    while ((match = pattern.exec(text))) segments.push(match[0]);
    return segments.length ? segments : [text];
  };

  const extractSentenceContext = (range, selectedText) => {
    const selection = normalizeContextText(selectedText);
    if (!range || !selection) return '';
    const block = findContextBlock(range.commonAncestorContainer);
    if (!block || isHiddenElement(block)) return '';
    const rawText = typeof block.textContent === 'string'
      ? block.textContent.slice(0, MAX_CONTEXT_SCAN_LENGTH)
      : '';
    const text = normalizeContextText(rawText);
    if (!text) return '';
    const selectedIndex = text.toLocaleLowerCase().indexOf(selection.toLocaleLowerCase());
    if (selectedIndex < 0) return '';
    let offset = 0;
    for (const segment of sentenceSegments(text)) {
      const start = text.indexOf(segment, offset);
      if (start < 0) continue;
      const end = start + segment.length;
      if (selectedIndex >= start && selectedIndex < end) {
        return normalizeContextText(segment).slice(0, MAX_CONTEXT_LENGTH);
      }
      offset = end;
    }
    return '';
  };

  const captureSelectionFromPage = () => {
    const rect = value => value && (value.width || value.height) ? {
      left: Number(value.left) || 0, top: Number(value.top) || 0,
      right: Number(value.right) || 0, bottom: Number(value.bottom) || 0,
      width: Number(value.width) || 0, height: Number(value.height) || 0,
    } : null;
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
      if (isHiddenElement(active)) return { text: '', anchor: null, context: '' };
      const start = active.selectionStart, end = active.selectionEnd;
      if (typeof start === 'number' && typeof end === 'number' && end > start) {
        return { text: active.value.slice(start, end), anchor: rect(active.getBoundingClientRect()), context: '' };
      }
    }
    const selection = globalThis.getSelection?.();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return { text: '', anchor: null, context: '' };
    const range = selection.getRangeAt(0);
    const text = selection.toString();
    if (!text || hasHiddenAncestor(range.commonAncestorContainer)) {
      return { text: '', anchor: null, context: '' };
    }
    return { text, anchor: rect(range.getBoundingClientRect()), context: extractSentenceContext(range, text) };
  };

  const speakText = (value, lang = 'en-US') => {
    const text = typeof value === 'string' ? value.trim() : '';
    const speech = globalThis.speechSynthesis;
    const Utterance = globalThis.SpeechSynthesisUtterance;
    if (!text || !speech || typeof speech.speak !== 'function' || typeof Utterance !== 'function') return false;
    try {
      speech.cancel?.();
      const utterance = new Utterance(text);
      utterance.lang = lang;
      speech.speak(utterance);
      return true;
    } catch {
      return false;
    }
  };

  const speechButton = (text, label, lang = 'en-US') => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'speak';
    button.textContent = '🔊';
    button.setAttribute('aria-label', label);
    button.title = label;
    button.disabled = !(globalThis.speechSynthesis && typeof globalThis.SpeechSynthesisUtterance === 'function');
    button.onclick = () => { speakText(text, lang); };
    return button;
  };

  const renderInlineBubble = payload => {
    const id = 'lingoflash-inline-translation-host';
    let host = document.getElementById(id);
    if (!host) {
      host = document.createElement('div');
      host.id = id;
      host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;width:min(360px,calc(100vw - 24px));pointer-events:auto';
      host.attachShadow({ mode: 'open' });
      document.documentElement.append(host);
    }
    const root = host.shadowRoot;
    if (!root) return { ok: false, error: 'Inline result host has no shadow root.' };
    root.replaceChildren();
    const style = document.createElement('style');
    style.textContent = '*{box-sizing:border-box}.c{border:1px solid #164e63;border-radius:16px;padding:14px;color:#f8fafc;background:#07111ff7;box-shadow:0 18px 55px #02061766;font:500 13px/1.45 system-ui,sans-serif}.h{display:flex;justify-content:space-between;gap:10px}.b{color:#67e8f9;font-size:10px;font-weight:800;letter-spacing:.1em}.source-line,.example-line{display:flex;align-items:center;gap:6px}.s{color:#94a3b8;font-size:12px;margin-top:2px;overflow-wrap:anywhere}.speak{border:1px solid #164e63;border-radius:7px;padding:2px 5px;color:#a5f3fc;background:#082f4933;cursor:pointer;font-size:11px}.speak:disabled{cursor:not-allowed;opacity:.45}.speak:focus-visible,.x:focus-visible{outline:2px solid #67e8f9;outline-offset:2px}.m{display:inline-block;color:#a5f3fc;background:#164e6355;border-radius:999px;padding:3px 7px;margin-top:6px;font-size:10px;font-weight:700}.x{border:0;background:transparent;color:#94a3b8;font:700 18px/1 sans-serif;cursor:pointer}.t{font-size:20px;font-weight:750;margin-top:10px}.p{color:#67e8f9;margin-top:3px}.e{color:#cbd5e1;margin-top:8px;font-size:12px}.e a{color:#67e8f9}.ok{color:#86efac;margin-top:10px;font-size:11px;font-weight:700}.err{color:#fca5a5;margin-top:10px}.load{color:#cbd5e1;margin-top:11px}.spin{display:inline-block;width:14px;height:14px;border:2px solid #164e63;border-top-color:#67e8f9;border-radius:50%;margin-right:8px;vertical-align:-2px;animation:r .8s linear infinite}@keyframes r{to{transform:rotate(360deg)}}@media (prefers-reduced-motion: reduce){.spin{animation:none}.x{transition:none}}';
    const card = document.createElement('section'); card.className = 'c'; card.setAttribute('role', 'status'); card.setAttribute('aria-live', 'polite');
    const head = document.createElement('div'); head.className = 'h';
    const info = document.createElement('div');
    const brand = document.createElement('div'); brand.className = 'b'; brand.textContent = payload.version ? `LINGOFLASH v${payload.version}` : 'LINGOFLASH';
    const source = document.createElement('div'); source.className = 's'; source.textContent = payload.text || '';
    const sourceLine = document.createElement('div'); sourceLine.className = 'source-line';
    sourceLine.append(source, speechButton(payload.text || '', `Nghe phát âm ${payload.text || 'từ đã chọn'}`));
    info.append(brand, sourceLine);
    if (payload.modeLabel) { const mode = document.createElement('span'); mode.className = 'm'; mode.textContent = payload.modeLabel; info.append(mode); }
    const close = document.createElement('button'); close.className = 'x'; close.type = 'button'; close.setAttribute('aria-label', 'Đóng kết quả LingoFlash'); close.textContent = '×'; close.onclick = () => host.remove();
    head.append(info, close); card.append(head);
    if (String(payload.status).startsWith('loading')) {
      const line = document.createElement('div'); line.className = 'load'; line.setAttribute('role', 'status'); line.setAttribute('aria-live', 'polite');
      const spinner = document.createElement('span'); spinner.className = 'spin'; spinner.setAttribute('aria-hidden', 'true');
      line.append(spinner, document.createTextNode(payload.status === 'loading-save' ? 'Đang tạo và lưu flashcard…' : 'Đang dịch nhanh…')); card.append(line);
    } else if (['translated','created','existing'].includes(payload.status)) {
      const text = document.createElement('div'); text.className = 't'; text.textContent = payload.translation || 'Đã xử lý'; card.append(text);
      if (payload.phonetic) { const p = document.createElement('div'); p.className = 'p'; p.textContent = payload.phonetic; card.append(p); }
      if (payload.explanation) { const e = document.createElement('div'); e.className = 'e'; e.textContent = payload.explanation; card.append(e); }
      if (payload.exampleSentence) {
        const exampleLine = document.createElement('div'); exampleLine.className = 'example-line';
        const e = document.createElement('div'); e.className = 'e'; e.textContent = `Ví dụ: ${payload.exampleSentence}`;
        exampleLine.append(e, speechButton(payload.exampleSentence, 'Nghe phát âm câu ví dụ'));
        card.append(exampleLine);
      }
      if (payload.exampleTranslation) { const e = document.createElement('div'); e.className = 'e'; e.textContent = `Dịch ví dụ: ${payload.exampleTranslation}`; card.append(e); }
      const ok = document.createElement('div'); ok.className = 'ok'; ok.textContent = payload.status === 'translated' ? 'Chỉ dịch • không lưu • không dùng quota AI' : payload.status === 'existing' ? 'Đã có trong thư viện' : 'Đã thêm vào thư viện'; card.append(ok);
    } else {
      const e = document.createElement('div'); e.className = payload.status === 'auth-required' ? 'e' : 'err';
      if (payload.status === 'auth-required') {
        e.append(document.createTextNode('Cần đăng nhập LingoFlash để hoàn tất. '));
        try {
          const login = new URL(payload.loginUrl || '');
          if (login.origin === 'https://encoded-hangout-433912-h2.web.app') {
            const link = document.createElement('a'); link.href = login.toString(); link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'Đăng nhập / mở thư viện'; e.append(link);
          }
        } catch {}
      } else e.textContent = payload.message || 'Không thể xử lý. Hãy thử lại.';
      card.append(e);
    }
    root.append(style, card);
    const a = payload.anchor, vw = Math.max(document.documentElement.clientWidth, innerWidth || 0), vh = Math.max(document.documentElement.clientHeight, innerHeight || 0);
    host.style.left = `${a ? Math.min(Math.max(12, Number(a.left)||12), Math.max(12,vw-372)) : Math.max(12,vw-372)}px`;
    host.style.top = `${a ? Math.min(Math.max(12,(Number(a.bottom)||0)+10), Math.max(12,vh-190)) : 16}px`;
    const duration = Number.isSafeInteger(payload.bubbleDurationMs) ? Math.max(0, payload.bubbleDurationMs) : 12_000;
    if (duration > 0 && ['translated','created','existing'].includes(payload.status)) setTimeout(() => host.isConnected && host.remove(), duration);
    return { ok: true };
  };

  globalThis.LingoFlashExtensionUi = Object.freeze({ captureSelectionFromPage, renderInlineBubble });
})();
