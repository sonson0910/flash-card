'use strict';

(() => {
  const captureSelectionFromPage = () => {
    // executeScript serializes this function into the page. Keep all helpers
    // it needs inside the function so protected pages do not lose closures.
    const isHidden = element => {
      if (!element || typeof element !== 'object') return false;
      if (element.hidden === true || element.getAttribute?.('aria-hidden') === 'true') return true;
      const tagName = String(element.tagName || '').toUpperCase();
      if (tagName === 'SCRIPT' || tagName === 'STYLE' || tagName === 'NOSCRIPT' || tagName === 'TEMPLATE') return true;
      if (tagName === 'INPUT' && ['password', 'hidden'].includes(String(element.type || '').toLowerCase())) return true;
      try {
        const style = globalThis.getComputedStyle?.(element);
        if (style && (style.display === 'none' || style.visibility === 'hidden')) return true;
      } catch {}
      return false;
    };
    const elementForNode = node => node?.nodeType === 1 ? node : node?.parentElement;
    const hasHiddenAncestorInPage = node => {
      let element = elementForNode(node);
      for (let depth = 0; element && depth < 16; depth += 1) {
        if (isHidden(element)) return true;
        const tagName = String(element.tagName || '').toUpperCase();
        if (tagName === 'BODY' || tagName === 'HTML') break;
        element = element.parentElement;
      }
      return false;
    };
    const findBlockInPage = node => {
      const blockTags = ['ADDRESS', 'ARTICLE', 'BLOCKQUOTE', 'DD', 'DIV', 'FIGCAPTION', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'MAIN', 'P', 'PRE', 'SECTION', 'TD', 'TH'];
      let element = elementForNode(node);
      let block = null;
      for (let depth = 0; element && depth < 16; depth += 1) {
        if (isHidden(element)) return null;
        const tagName = String(element.tagName || '').toUpperCase();
        if (!block && blockTags.includes(tagName)) block = element;
        if (tagName === 'BODY' || tagName === 'HTML') break;
        element = element.parentElement;
      }
      return block;
    };
    const segmentsInPage = text => {
      try {
        const Segmenter = globalThis.Intl?.Segmenter;
        if (typeof Segmenter === 'function') {
          const segmenter = new Segmenter(undefined, { granularity: 'sentence' });
          return Array.from(segmenter.segment(text), value => value.segment);
        }
      } catch {}
      const segments = [];
      const pattern = /[^.!?…\n]+(?:[.!?…]+|$)/g;
      let match;
      while ((match = pattern.exec(text))) segments.push(match[0]);
      return segments.length ? segments : [text];
    };
    const contextInPage = (range, selectedText) => {
      const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
      const selection = normalize(selectedText);
      if (!range || !selection) return '';
      const block = findBlockInPage(range.commonAncestorContainer);
      if (!block || isHidden(block)) return '';
      const maxScan = 2_000;
      const marker = '\u0000';
      let markedText = '';
      try {
        const blockRange = document.createRange();
        blockRange.selectNodeContents(block);
        const prefixRange = blockRange.cloneRange();
        prefixRange.setEnd(range.startContainer, range.startOffset);
        const suffixRange = blockRange.cloneRange();
        suffixRange.setStart(range.endContainer, range.endOffset);
        // Keep the scan bounded while retaining the actual selection occurrence.
        const prefix = prefixRange.toString();
        const selected = range.toString();
        const suffix = suffixRange.toString();
        const contextBudget = Math.max(0, maxScan - selected.length);
        let prefixLength = Math.min(prefix.length, Math.floor(contextBudget / 2));
        let suffixLength = Math.min(suffix.length, contextBudget - prefixLength);
        const remainingPrefixBudget = contextBudget - prefixLength - suffixLength;
        prefixLength += Math.min(prefix.length - prefixLength, remainingPrefixBudget);
        const remainingSuffixBudget = contextBudget - prefixLength - suffixLength;
        suffixLength += Math.min(suffix.length - suffixLength, remainingSuffixBudget);
        markedText = `${prefix.slice(-prefixLength)}${marker}${selected}${suffix.slice(0, suffixLength)}`
          .replace(/\s+/g, ' ')
          .trim();
      } catch {
        // A protected/partial DOM can reject Range operations. Preserve the
        // text-only flow instead of guessing an occurrence with indexOf().
        return '';
      }
      const markerIndex = markedText.indexOf(marker);
      if (markerIndex < 0) return '';
      const text = markedText.replace(marker, '');
      const selectedIndex = markerIndex;
      if (!text || selectedIndex >= text.length) return '';
      let offset = 0;
      for (const segment of segmentsInPage(text)) {
        const start = text.indexOf(segment, offset);
        if (start < 0) continue;
        const end = start + segment.length;
        if (selectedIndex >= start && selectedIndex < end) {
          const normalizedSegment = normalize(segment);
          if (normalizedSegment.length <= 500) return normalizedSegment;
          const leadingWhitespace = segment.length - segment.trimStart().length;
          const selectedLength = Math.min(normalize(selection).length, 500);
          const selectedOffset = Math.max(0, Math.min(
            normalizedSegment.length - selectedLength,
            selectedIndex - start - leadingWhitespace,
          ));
          let windowStart = Math.max(0, selectedOffset - Math.floor((500 - selectedLength) / 2));
          windowStart = Math.min(windowStart, normalizedSegment.length - 500);
          return normalizedSegment.slice(windowStart, windowStart + 500);
        }
        offset = end;
      }
      return '';
    };
    const rect = value => value && (value.width || value.height) ? {
      left: Number(value.left) || 0, top: Number(value.top) || 0,
      right: Number(value.right) || 0, bottom: Number(value.bottom) || 0,
      width: Number(value.width) || 0, height: Number(value.height) || 0,
    } : null;
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
      if (isHidden(active)) return { text: '', anchor: null, context: '' };
      const start = active.selectionStart, end = active.selectionEnd;
      if (typeof start === 'number' && typeof end === 'number' && end > start) {
        return { text: active.value.slice(start, end), anchor: rect(active.getBoundingClientRect()), context: '' };
      }
    }
    const selection = globalThis.getSelection?.();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return { text: '', anchor: null, context: '' };
    const range = selection.getRangeAt(0);
    const text = selection.toString();
    if (!text || hasHiddenAncestorInPage(range.commonAncestorContainer)) {
      return { text: '', anchor: null, context: '' };
    }
    return { text, anchor: rect(range.getBoundingClientRect()), context: contextInPage(range, text) };
  };

  const renderInlineBubble = payload => {
    // executeScript serializes only this function; these helpers must remain
    // self-contained and cannot rely on the service-worker closure.
    const id = 'lingoflash-inline-translation-host';
    const speechStatusId = `${id}-speech-status`;
    const speechSupportedInPage = () => Boolean(
      globalThis.speechSynthesis && typeof globalThis.speechSynthesis.speak === 'function'
        && typeof globalThis.SpeechSynthesisUtterance === 'function',
    );
    const speechLocale = value => {
      const code = String(value || '').toLowerCase().split('-')[0];
      const locales = { en: 'en-US', vi: 'vi-VN', fr: 'fr-FR', de: 'de-DE', es: 'es-ES', it: 'it-IT', pt: 'pt-BR', ja: 'ja-JP', ko: 'ko-KR', zh: 'zh-CN', ru: 'ru-RU' };
      return locales[code] || 'en-US';
    };
    const svgIconInPage = kind => {
      if (typeof document.createElementNS !== 'function') return null;
      const paths = kind === 'volume'
        ? ['M11 5 6 9H3v6h3l5 4V5Z', 'm15.5 8.5 3 3-3 3', 'M15.5 5.5a7 7 0 0 1 0 11']
        : ['M6 6l12 12', 'M18 6 6 18'];
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('width', '14');
      svg.setAttribute('height', '14');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '2');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');
      svg.setAttribute('aria-hidden', 'true');
      paths.forEach(d => {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        svg.append(path);
      });
      return svg;
    };
    const setSpeechState = (button, state, label) => {
      if (button.dataset) button.dataset.speechState = state;
      else button.setAttribute('data-speech-state', state);
      const suffix = state === 'playing' ? ' (đang phát)' : state === 'error' ? ' (lỗi)' : '';
      button.setAttribute('aria-label', `${label}${suffix}`);
    };
    const speakTextInPage = (value, lang = 'en-US', button = null, label = 'Nghe phát âm') => {
      const text = typeof value === 'string' ? value.trim() : '';
      const speech = globalThis.speechSynthesis;
      const Utterance = globalThis.SpeechSynthesisUtterance;
      if (!text || !speech || typeof speech.speak !== 'function' || typeof Utterance !== 'function') return false;
      if (button) setSpeechState(button, 'playing', label);
      try {
        speech.cancel?.();
        const utterance = new Utterance(text);
        utterance.lang = speechLocale(lang);
        utterance.rate = 0.88;
        utterance.onend = () => { if (button) setSpeechState(button, 'ended', label); };
        utterance.onerror = () => { if (button) setSpeechState(button, 'error', label); };
        speech.speak(utterance);
        return true;
      } catch {
        if (button) setSpeechState(button, 'error', label);
        return false;
      }
    };
    const speechButtonInPage = (text, label, lang = 'en-US') => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'speak';
      const icon = svgIconInPage('volume');
      if (icon) button.append(icon);
      else button.textContent = 'Nghe';
      button.title = label;
      const supported = speechSupportedInPage();
      button.disabled = !supported;
      if (!supported) button.setAttribute('aria-describedby', speechStatusId);
      setSpeechState(button, 'idle', label);
      button.onclick = () => { speakTextInPage(text, lang, button, label); };
      return button;
    };
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
    style.textContent = '*{box-sizing:border-box}.c{border:1px solid rgba(103,232,249,0.22);border-radius:18px;padding:15px 16px;color:#f8fafc;background:rgba(7,17,31,0.88);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);box-shadow:0 24px 60px -12px rgba(2,6,23,0.75),0 0 24px rgba(34,211,238,0.08);font:500 13px/1.45 system-ui,-apple-system,BlinkMacSystemFont,sans-serif;animation:sf-fade .18s cubic-bezier(0.16,1,0.3,1) forwards;max-height:calc(100vh - 24px);overflow:auto;overscroll-behavior:contain}@keyframes sf-fade{from{opacity:0;transform:translateY(4px) scale(0.98)}to{opacity:1;transform:translateY(0) scale(1)}}.h{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.b{color:#67e8f9;font-size:10px;font-weight:800;letter-spacing:.12em}.source-line,.example-line{display:flex;align-items:center;gap:7px}.example-line{align-items:flex-start}.example-line .e{min-width:0}.s{color:#94a3b8;font-size:12px;margin-top:2px;overflow-wrap:anywhere}.speak{border:1px solid rgba(103,232,249,0.25);border-radius:8px;padding:3px 7px;color:#a5f3fc;background:rgba(8,47,73,0.35);cursor:pointer;font-size:11px;display:inline-flex;align-items:center;gap:4px;transition:all .15s ease}.speak:hover{border-color:#67e8f9;background:rgba(14,116,144,0.4);transform:translateY(-1px)}.speak[data-speech-state="playing"]{color:#facc15;border-color:#facc15}.speak[data-speech-state="ended"]{color:#86efac;border-color:#86efac}.speak[data-speech-state="error"]{color:#fca5a5;border-color:#fca5a5}.speak:disabled{cursor:not-allowed;opacity:.45;transform:none}.speak:focus-visible,.x:focus-visible{outline:2px solid #67e8f9;outline-offset:2px}.speech-help{color:#fbbf24;font-size:11px;margin-top:5px}.m{display:inline-block;color:#a5f3fc;background:rgba(22,78,99,0.45);border:1px solid rgba(103,232,249,0.18);border-radius:999px;padding:3px 9px;margin-top:6px;font-size:10px;font-weight:700}.x{border:0;background:rgba(255,255,255,0.05);color:#94a3b8;font:700 16px/1 sans-serif;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .15s ease}.x:hover{background:rgba(255,255,255,0.15);color:#f8fafc;transform:scale(1.08)}.t{font-size:20px;font-weight:800;margin-top:10px;color:#f8fafc;letter-spacing:-0.02em}.p{color:#67e8f9;margin-top:3px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}.e{color:#cbd5e1;margin-top:8px;font-size:12px;line-height:1.45}.e a{color:#67e8f9;text-decoration:underline}.ok{color:#86efac;margin-top:10px;font-size:11px;font-weight:700;display:flex;align-items:center;gap:4px}.err{color:#fca5a5;margin-top:10px;background:rgba(239,68,68,0.1);padding:8px 10px;border-radius:8px;border:1px solid rgba(248,113,113,0.2)}.load{color:#cbd5e1;margin-top:11px;display:flex;align-items:center}.spin{display:inline-block;width:14px;height:14px;border:2px solid #164e63;border-top-color:#67e8f9;border-radius:50%;margin-right:8px;vertical-align:-2px;animation:r .8s linear infinite}@keyframes r{to{transform:rotate(360deg)}}@media (prefers-reduced-motion: reduce){.spin{animation:none}.c{animation:none}.x{transition:none}.speak{transition:none}}';
    const card = document.createElement('section'); card.className = 'c'; card.setAttribute('role', 'status'); card.setAttribute('aria-live', 'polite');
    const head = document.createElement('div'); head.className = 'h';
    const info = document.createElement('div');
    const brand = document.createElement('div'); brand.className = 'b'; brand.textContent = payload.version ? `LINGOFLASH v${payload.version}` : 'LINGOFLASH';
    const source = document.createElement('div'); source.className = 's'; source.textContent = payload.text || '';
    const sourceLine = document.createElement('div'); sourceLine.className = 'source-line';
    const sourceSpeaker = speechButtonInPage(payload.text || '', `Nghe phát âm ${payload.text || 'từ đã chọn'}`, payload.speechLocale);
    sourceLine.append(source, sourceSpeaker);
    info.append(brand, sourceLine);
    if (!speechSupportedInPage()) {
      const speechHelp = document.createElement('div');
      speechHelp.id = speechStatusId;
      speechHelp.className = 'speech-help';
      speechHelp.setAttribute('role', 'status');
      speechHelp.setAttribute('aria-live', 'polite');
      speechHelp.textContent = 'Trình duyệt này không hỗ trợ phát âm.';
      info.append(speechHelp);
    }
    if (payload.modeLabel) { const mode = document.createElement('span'); mode.className = 'm'; mode.textContent = payload.modeLabel; info.append(mode); }
    const close = document.createElement('button'); close.className = 'x'; close.type = 'button'; close.setAttribute('aria-label', 'Đóng kết quả LingoFlash');
    const closeIcon = svgIconInPage('close');
    if (closeIcon) close.append(closeIcon);
    else close.textContent = 'Đóng';
    close.onclick = () => host.remove();
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
        exampleLine.append(e, speechButtonInPage(payload.exampleSentence, 'Nghe phát âm câu ví dụ', payload.speechLocale));
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
    if (payload.autoSpeak && ['translated', 'created', 'existing'].includes(payload.status)) {
      speakTextInPage(payload.text || '', payload.speechLocale, sourceSpeaker, `Nghe phát âm ${payload.text || 'từ đã chọn'}`);
    }
    const a = payload.anchor, vw = Math.max(document.documentElement.clientWidth, innerWidth || 0), vh = Math.max(document.documentElement.clientHeight, innerHeight || 0);
    host.style.left = `${a ? Math.min(Math.max(12, Number(a.left)||12), Math.max(12,vw-372)) : Math.max(12,vw-372)}px`;
    const measuredHeight = Number(card.getBoundingClientRect?.().height) || 190;
    const cardHeight = Math.min(measuredHeight, Math.max(0, vh - 24));
    const desiredTop = a ? (Number(a.bottom) || 0) + 10 : 16;
    host.style.top = `${Math.min(Math.max(12, desiredTop), Math.max(12, vh - cardHeight - 12))}px`;
    const duration = Number.isSafeInteger(payload.bubbleDurationMs) ? Math.max(0, payload.bubbleDurationMs) : 12_000;
    if (duration > 0 && ['translated','created','existing'].includes(payload.status)) setTimeout(() => host.isConnected && host.remove(), duration);
    return { ok: true };
  };

  globalThis.LingoFlashExtensionUi = Object.freeze({ captureSelectionFromPage, renderInlineBubble });
})();
