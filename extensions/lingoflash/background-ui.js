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
    // The language the page declares for the selected text (its nearest
    // lang attribute), as a bare primary subtag; empty when none is declared.
    const pageLanguageInPage = node => {
      const element = node?.nodeType === 1 ? node : node?.parentElement;
      const declared = element?.closest?.('[lang]')?.getAttribute?.('lang') || '';
      const match = /^([a-z]{2,3})(?:-|$)/i.exec(declared.trim());
      return match ? match[1].toLowerCase() : '';
    };
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
      if (isHidden(active)) return { text: '', anchor: null, context: '' };
      const start = active.selectionStart, end = active.selectionEnd;
      if (typeof start === 'number' && typeof end === 'number' && end > start) {
        return { text: active.value.slice(start, end), anchor: rect(active.getBoundingClientRect()), context: '', pageLanguage: pageLanguageInPage(active) };
      }
    }
    const selection = globalThis.getSelection?.();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return { text: '', anchor: null, context: '' };
    const range = selection.getRangeAt(0);
    const text = selection.toString();
    if (!text || hasHiddenAncestorInPage(range.commonAncestorContainer)) {
      return { text: '', anchor: null, context: '' };
    }
    return { text, anchor: rect(range.getBoundingClientRect()), context: contextInPage(range, text), pageLanguage: pageLanguageInPage(range.commonAncestorContainer) };
  };

  const renderInlineBubble = payload => {
    // executeScript serializes only this function; these helpers must remain
    // self-contained and cannot rely on the service-worker closure.
    const id = 'lingoflash-inline-translation-host';
    const speechStatusId = `${id}-speech-status`;
    // Content scripts and executeScript-injected functions keep access to
    // chrome.i18n; this falls back to the same literal SonFlash copy outside
    // a real extension runtime (e.g. unit tests).
    const bt = (name, substitutions, fallback) => {
      try {
        const resolved = (globalThis.browser ?? globalThis.chrome)?.i18n?.getMessage(name, substitutions);
        return typeof resolved === 'string' && resolved ? resolved : fallback;
      } catch { return fallback; }
    };
    // Mirrors popup.js's QUOTA_MESSAGE_HINTS/isQuotaMessage. This function is
    // serialized standalone into the page via executeScript, so it cannot
    // import that module — the same substrings captureFailureMessage.ts
    // guarantees for a quota-kind error are duplicated here instead.
    const isQuotaMessageInPage = message => typeof message === 'string'
      && ['hạn mức', 'số thẻ', 'lượt AI'].some(hint => message.includes(hint));
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
      const icons = {
        play: ['M8 5.5v13l11-6.5z'],
        close: ['M6 6l12 12', 'M18 6 6 18'],
        globe: ['M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18z', 'M3 12h18', 'M12 3c2.4 2.5 3.6 5.5 3.6 9s-1.2 6.5-3.6 9c-2.4-2.5-3.6-5.5-3.6-9s1.2-6.5 3.6-9z'],
        plus: ['M12 5v14', 'M5 12h14'],
      };
      const paths = icons[kind] || icons.close;
      const size = kind === 'play' ? '12' : kind === 'globe' ? '13' : '14';
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('width', size);
      svg.setAttribute('height', size);
      svg.setAttribute('fill', kind === 'play' ? 'currentColor' : 'none');
      svg.setAttribute('stroke', kind === 'play' ? 'none' : 'currentColor');
      svg.setAttribute('stroke-width', kind === 'plus' ? '2.4' : '2');
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
    // Crystal Star art, inlined so the bubble never loads an extension file
    // into the page (the extension declares no web_accessible_resources).
    // The wings are the board's polygon art drawn as inline SVG; Lumi is a
    // small decorative image that simply disappears where a page's
    // content-security policy blocks data: images.
    const crystalWingsInPage = () => {
      if (typeof document.createElementNS !== 'function') return null;
      const ns = 'http://www.w3.org/2000/svg';
      const feathers = [
        ['300,300 307.5,279.3 262.2,265 255.5,239.4 202,247.6 193.8,226.3 141.8,230.2 132,213.3 65.1,214.5 159,248.7', '300,300 159,248.7 65.1,214.5 164,271.6 294.7,314.5'],
        ['300,300 318.4,281.6 288.7,253.9 295.4,222.6 244.8,215.7 248.4,187.5 201,177.5 201.5,152.4 157.2,139.4 154.6,117.3 94.9,94.9 177,177', '300,300 177,177 94.9,94.9 170.7,203.8 287.1,312.9'],
        ['300,300 321.9,292.9 305.2,248.4 322.2,227.1 281.6,190.3 294.1,170.5 258.1,132.2 266,113.9 222.7,62.2 253.6,157.3', '300,300 253.6,157.3 222.7,62.2 237.8,175.6 284.7,305'],
        ['300,300 317.7,303.1 324.4,248.8 342.8,239.9 331.5,182.3 344.9,172.5 334.7,103 320.8,181.8', '300,300 320.8,181.8 334.7,103 303.1,188.9 287.6,297.8'],
        ['300,300 297,283.3 246.4,294.9 232.4,281.5 184.8,310.2 171.6,301.5 112.9,333 187.7,319.8', '300,300 187.7,319.8 112.9,333 199.7,333.2 302.1,311.7'],
        ['300,300 311.5,308 333.2,273.2 348.9,273.2 358.9,230.2 371.4,227.9 386,177.1 351.6,226.3', '300,300 351.6,226.3 386,177.1 337,225.2 292,294.4'],
      ];
      const star = [
        '300,300 285.7,280.3 300,242',
        '300,300 300,242 314.3,280.3',
        '300,300 314.3,280.3 355.2,282.1',
        '300,300 355.2,282.1 323.2,307.5',
        '300,300 323.2,307.5 334.1,346.9',
        '300,300 334.1,346.9 300,324.4',
        '300,300 300,324.4 265.9,346.9',
        '300,300 265.9,346.9 276.8,307.5',
        '300,300 276.8,307.5 244.8,282.1',
        '300,300 244.8,282.1 285.7,280.3',
      ];
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('viewBox', '0 0 600 400');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      const shape = (tagName, points, attributes) => {
        const element = document.createElementNS(ns, tagName);
        element.setAttribute('points', points);
        Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, value));
        svg.append(element);
      };
      feathers.forEach(([blade, shade]) => {
        shape('polygon', blade, { fill: '#e0173f' });
        shape('polygon', shade, { fill: '#7a0820' });
        shape('polyline', shade.split(' ').slice(0, 3).join(' '), { fill: 'none', stroke: '#ffc2cf', 'stroke-width': '1.4', 'stroke-linejoin': 'round', opacity: '0.8' });
      });
      star.forEach((points, index) => shape('polygon', points, { fill: index % 2 ? '#7a0820' : '#ff5470' }));
      return svg;
    };
    const crystalLumiInPage = () => {
      const slot = document.createElement('span');
      slot.className = 'lumi';
      slot.setAttribute('aria-hidden', 'true');
      const image = document.createElement('img');
      image.alt = '';
      image.draggable = false;
      image.onerror = () => slot.remove();
      image.src = 'data:image/webp;base64,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';
      slot.append(image);
      return slot;
    };
    // Language-pack courses (Korean, Japanese, Chinese) get the language
    // board's treatment: the word in a CJK face with its language tagged, the
    // detected language above it and "Save to <course>" in the footer. Only
    // languages the extension really knows are shown: the confirmed active
    // course, Google's detection of the selection and the page's own lang.
    const languageCodeInPage = value => {
      const match = /^([a-z]{2,3})(?:[-_]|$)/i.exec(String(value || '').trim());
      return match ? match[1].toLowerCase() : '';
    };
    const autonymInPage = code => {
      try {
        const name = new Intl.DisplayNames([code], { type: 'language' }).of(code);
        if (typeof name === 'string' && name && name.toLowerCase() !== code) return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
      } catch {}
      return code;
    };
    const courseLanguage = ['en', 'ko', 'ja', 'zh'].includes(payload.courseLanguage) ? payload.courseLanguage : '';
    const nativeLanguage = ['vi', 'en'].includes(payload.nativeLanguage) ? payload.nativeLanguage : '';
    const languageMode = ['ko', 'ja', 'zh'].includes(courseLanguage);
    const detectedLanguage = languageCodeInPage(payload.sourceLanguage);
    const pageLanguage = languageCodeInPage(payload.pageLanguage);
    const wordLanguage = detectedLanguage || (languageMode ? courseLanguage : '');
    const setSpeechState = (button, state, label) => {
      if (button.dataset) button.dataset.speechState = state;
      else button.setAttribute('data-speech-state', state);
      const suffix = state === 'playing' ? bt('bubbleSpeechPlayingSuffix', undefined, ' (đang phát)') : state === 'error' ? bt('bubbleSpeechErrorSuffix', undefined, ' (lỗi)') : '';
      button.setAttribute('aria-label', `${label}${suffix}`);
    };
    const speakTextInPage = (value, lang = 'en-US', button = null, label) => {
      const resolvedLabel = label ?? bt('bubbleSpeakDefaultLabel', undefined, 'Nghe phát âm');
      const text = typeof value === 'string' ? value.trim() : '';
      const speech = globalThis.speechSynthesis;
      const Utterance = globalThis.SpeechSynthesisUtterance;
      if (!text || !speech || typeof speech.speak !== 'function' || typeof Utterance !== 'function') return false;
      if (button) setSpeechState(button, 'playing', resolvedLabel);
      try {
        speech.cancel?.();
        const utterance = new Utterance(text);
        utterance.lang = speechLocale(lang);
        utterance.rate = 0.88;
        utterance.onend = () => { if (button) setSpeechState(button, 'ended', resolvedLabel); };
        utterance.onerror = () => { if (button) setSpeechState(button, 'error', resolvedLabel); };
        speech.speak(utterance);
        return true;
      } catch {
        if (button) setSpeechState(button, 'error', resolvedLabel);
        return false;
      }
    };
    const speechButtonInPage = (text, label, lang = 'en-US') => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'speak';
      const icon = svgIconInPage('play');
      if (icon) button.append(icon);
      else button.textContent = bt('recentSpeakLabel', undefined, 'Nghe');
      button.title = label;
      const supported = speechSupportedInPage();
      button.disabled = !supported;
      if (!supported) button.setAttribute('aria-describedby', speechStatusId);
      setSpeechState(button, 'idle', label);
      button.onclick = () => { speakTextInPage(text, lang, button, label); };
      return button;
    };
    // The bubble follows the extension's saved look (Classic or Crystal Star,
    // light or dark); "system" resolves against the page's colour scheme.
    const family = payload.themeFamily === 'crystal' ? 'crystal' : 'classic';
    let prefersDark = false;
    try { prefersDark = Boolean(globalThis.matchMedia?.('(prefers-color-scheme: dark)')?.matches); } catch {}
    const scheme = payload.colorScheme === 'dark' || payload.colorScheme === 'light' ? payload.colorScheme : (prefersDark ? 'dark' : 'light');
    const bubbleWidth = family === 'crystal' ? 440 : 380;
    let host = document.getElementById(id);
    if (!host) {
      host = document.createElement('div');
      host.id = id;
      host.attachShadow({ mode: 'open' });
      document.documentElement.append(host);
    }
    const root = host.shadowRoot;
    if (!root) return { ok: false, error: 'Inline result host has no shadow root.' };
    host.style.cssText = `all:initial;position:fixed;z-index:2147483647;width:min(${bubbleWidth}px,calc(100vw - 24px));pointer-events:auto`;
    root.replaceChildren();
    const style = document.createElement('style');
    style.textContent = [
      '*{box-sizing:border-box}',
      '.frame{position:relative;--sf-font-display:"Fraunces",Georgia,"Times New Roman",serif;--sf-font-body:"Geist","Segoe UI",system-ui,-apple-system,sans-serif;--sf-font-mono:"Geist Mono",ui-monospace,SFMono-Regular,Menlo,monospace;--display-weight:440;--radius:20px;--border:1.5px solid transparent;--bg:radial-gradient(ellipse 80% 60% at 100% 0%,rgb(150 108 215/.25),transparent 70%) padding-box,linear-gradient(180deg,#0f2430,#0a1a22) padding-box,linear-gradient(155deg,#7ee6fa,rgb(40 211 244/.2) 40%,rgb(150 108 215/.35) 75%,#b395ea) border-box;--shadow:0 30px 60px -20px rgb(6 22 31/.55),0 0 40px -12px rgb(40 211 244/.45);--caret-bg:#0f2430;--caret-line:1.5px solid #7ee6fa;--text:#e5ecf1;--strong:#f1f6f9;--body:#b5c2ca;--text2:#99a7b0;--text3:#6f808a;--line:rgb(255 255 255/.08);--chip:rgb(255 255 255/.04);--accent:#28d3f4;--accent-text:#7ee6fa;--accent-soft:rgb(40 211 244/.12);--accent-line:rgb(40 211 244/.35);--primary-bg:#28d3f4;--primary-text:#04141c;--primary-shadow:0 16px 40px -14px rgb(40 211 244/.8),inset 0 1px 0 rgb(255 255 255/.5);--ok:#9be09e;--ok-bg:rgb(117 208 121/.12);--ok-line:rgb(117 208 121/.32);--danger:#ff8a86;--danger-bg:rgb(237 83 80/.12);--danger-line:rgb(237 83 80/.35);--warn:#f7c46e;--warn-bg:rgb(245 174 57/.1);--warn-line:rgb(245 174 57/.32)}',
      '.frame[data-scheme="light"]{--display-weight:380;--radius:14px;--border:1px solid rgb(29 26 22/.1);--bg:#fffcf5;--shadow:0 2px 4px rgb(60 40 20/.08),0 30px 50px -24px rgb(60 40 20/.45);--caret-bg:#fffcf5;--caret-line:1px solid rgb(29 26 22/.1);--text:#1d1a16;--strong:#1d1a16;--body:#3d372f;--text2:#6b6255;--text3:#8a8072;--line:rgb(29 26 22/.1);--chip:#fbf8f2;--accent:#b4461a;--accent-text:#97400d;--accent-soft:rgb(180 70 26/.08);--accent-line:rgb(151 64 13/.25);--primary-bg:#1d1a16;--primary-text:#fbf6ec;--primary-shadow:0 14px 28px -14px rgb(29 26 22/.9);--ok:#2c6a3d;--ok-bg:rgb(51 115 68/.09);--ok-line:rgb(51 115 68/.25);--danger:#b3261e;--danger-bg:rgb(197 54 55/.07);--danger-line:rgb(197 54 55/.25);--warn:#8a5a0c;--warn-bg:rgb(184 134 43/.1);--warn-line:rgb(184 134 43/.3)}',
      '.frame[data-family="crystal"]{--sf-font-display:"Kanit","Nunito",system-ui,sans-serif;--sf-font-body:"Nunito",system-ui,sans-serif;--radius:0;--border:2px solid transparent;--bg:linear-gradient(180deg,#121624 0%,#080a12 100%) padding-box,linear-gradient(150deg,#ffe3f1,#ff8fb6 35%,#ff5470 65%,#5ef2ff) border-box;--shadow:none;--text:#f3f5fa;--strong:#ffffff;--body:#d6dbe6;--text2:#aab3c5;--text3:#7a8397;--line:rgb(255 255 255/.1);--line-strong:rgb(255 255 255/.22);--chip:rgb(255 255 255/.06);--accent:#5ef2ff;--accent-text:#ff6b85;--holo:#5ef2ff;--accent-soft:rgb(94 242 255/.12);--accent-line:rgb(94 242 255/.4);--primary-bg:linear-gradient(180deg,#ff5470 0%,#ff2a4d 45%,#b30f33 100%);--primary-text:#ffffff;--primary-shadow:0 0 30px -4px rgb(255 42 77/.85);--ok:#5ef2ff;--ok-bg:rgb(94 242 255/.12);--ok-line:rgb(94 242 255/.4);--danger:#ff6b85;--danger-bg:rgb(255 42 77/.12);--danger-line:rgb(255 84 112/.45);--warn:#ffd166;--warn-bg:rgb(255 209 102/.1);--warn-line:rgb(255 209 102/.35);filter:drop-shadow(0 30px 40px rgb(0 0 0/.35)) drop-shadow(0 0 18px rgb(255 143 182/.55))}',
      '.frame[data-family="crystal"][data-scheme="light"]{--bg:linear-gradient(180deg,#f2faff 0%,#d9eeff 100%) padding-box,linear-gradient(150deg,#ffe3f1,#ff8fb6 35%,#ff5470 65%,#5ef2ff) border-box;--text:#0d1a33;--strong:#081329;--body:#243553;--text2:#3f5272;--text3:#627392;--line:rgb(13 40 80/.12);--line-strong:rgb(13 40 80/.24);--chip:rgb(226 244 255/.9);--accent:#0a7d99;--accent-text:#c40f35;--holo:#0a7d99;--accent-soft:rgb(26 167 201/.12);--accent-line:rgb(26 167 201/.45);--primary-bg:linear-gradient(180deg,#ff5470 0%,#e0173f 50%,#a30c2d 100%);--primary-shadow:0 12px 28px -8px rgb(224 23 63/.6);--ok:#0a7d99;--ok-bg:rgb(26 167 201/.12);--ok-line:rgb(26 167 201/.45);--danger:#c40f35;--danger-bg:rgb(224 23 63/.08);--danger-line:rgb(224 23 63/.3);--warn:#8a5a00;--warn-bg:rgb(255 209 102/.18);--warn-line:rgb(138 90 0/.3);filter:drop-shadow(0 30px 40px rgb(20 70 130/.25)) drop-shadow(0 0 18px rgb(255 143 182/.55))}',
      '.caret{position:absolute;left:24px;top:-7px;z-index:1;width:14px;height:14px;transform:rotate(45deg);background:var(--caret-bg);border-left:var(--caret-line);border-top:var(--caret-line)}',
      '.frame[data-family="crystal"] .caret{top:-9px;width:20px;height:12px;transform:none;border:0;background:#ff8fb6;clip-path:polygon(50% 0,100% 100%,0 100%)}',
      '.caret[hidden]{display:none}',
      '.c{position:relative;border:var(--border);border-radius:var(--radius);background:var(--bg);box-shadow:var(--shadow);color:var(--text);font:400 13px/1.45 var(--sf-font-body);-webkit-font-smoothing:antialiased;animation:sf-fade .18s cubic-bezier(0.16,1,0.3,1) forwards;max-height:calc(100vh - 24px);overflow:auto;overscroll-behavior:contain}',
      '.frame[data-family="crystal"] .c{clip-path:polygon(18px 0,100% 0,100% calc(100% - 18px),calc(100% - 18px) 100%,0 100%,0 18px)}',
      '@keyframes sf-fade{from{opacity:0;transform:translateY(4px) scale(0.98)}to{opacity:1;transform:translateY(0) scale(1)}}',
      '.body{padding:18px 20px 16px}.frame[data-family="crystal"] .body{padding:16px 20px 14px}',
      '.h{display:flex;align-items:center;gap:10px}.info{min-width:0;flex:1 1 auto}',
      '.source-line,.example-line{display:flex;align-items:center;gap:10px}.example-line{align-items:flex-start;gap:8px}.example-line .e{min-width:0;flex:1 1 auto;margin-top:0}',
      '.s{min-width:0;color:var(--strong);font-family:var(--sf-font-display);font-size:34px;font-weight:var(--display-weight);line-height:1;letter-spacing:-.02em;overflow-wrap:anywhere}',
      '.frame[data-family="crystal"] .s{font-style:italic;font-weight:900;letter-spacing:0}',
      '.speak{flex:none;width:34px;height:34px;padding:0;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--accent-line);border-radius:50%;background:var(--accent-soft);color:var(--accent-text);cursor:pointer;font:600 12px/1 var(--sf-font-body);transition:transform .15s ease,background-color .15s ease,border-color .15s ease}',
      '.example-line .speak{width:28px;height:28px}',
      '.frame[data-family="crystal"] .speak{border:0;border-radius:0;background:var(--primary-bg);color:#ffffff;clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%)}',
      '.speak:hover{transform:translateY(-1px)}',
      '.speak[data-speech-state="playing"]{border-color:var(--warn);color:var(--warn)}.speak[data-speech-state="ended"]{border-color:var(--ok);color:var(--ok)}.speak[data-speech-state="error"]{border-color:var(--danger);color:var(--danger)}',
      '.speak:disabled{cursor:not-allowed;opacity:.45;transform:none}',
      '.speak[data-kind="action"]{width:auto;height:42px;padding:0 16px;border:0;border-radius:12px;background:var(--primary-bg);color:var(--primary-text);box-shadow:var(--primary-shadow);font-size:13.5px;font-weight:650;clip-path:none}',
      '.frame[data-family="crystal"] .speak[data-kind="action"]{border-radius:0;font-family:var(--sf-font-display);font-style:italic;font-weight:900;letter-spacing:.04em;text-transform:uppercase;clip-path:polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%,0 10px)}',
      '.speak:focus-visible,.x:focus-visible,.e a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}',
      '.speech-help{color:var(--warn);font-size:11.5px;margin-top:6px}',
      '.x{flex:none;margin-left:auto;align-self:flex-start;width:32px;height:32px;border:0;border-radius:50%;background:transparent;color:var(--text3);display:flex;align-items:center;justify-content:center;cursor:pointer;font:700 16px/1 var(--sf-font-body);transition:background-color .15s ease,color .15s ease}',
      '.x:hover{background:var(--chip);color:var(--strong)}',
      '.frame[data-family="crystal"] .x{width:30px;height:30px;border-radius:0;background:var(--chip);color:var(--text2);clip-path:polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%,0 10px)}',
      '.p{margin-top:6px;color:var(--text2);font-family:var(--sf-font-mono);font-size:12.5px}',
      '.t{margin-top:12px;color:var(--accent-text);font-family:var(--sf-font-display);font-size:26px;font-weight:var(--display-weight);line-height:1.15;overflow-wrap:anywhere}',
      '.frame[data-family="crystal"] .t{margin-top:10px;font-style:italic;font-weight:800}',
      '.e{margin-top:6px;color:var(--body);font-size:13.5px;line-height:1.5}.e a{color:var(--accent-text);text-decoration:underline}',
      '.example{margin-top:12px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--chip)}',
      '.example .e{color:var(--text2);font-size:12.5px}.example .e + .e{margin-top:4px}',
      '.frame[data-family="crystal"] .example{border:0;border-radius:0;box-shadow:inset 3px 0 0 var(--holo);clip-path:polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%,0 10px)}',
      '.ai-note{margin-top:10px;color:var(--text3);font-size:11.5px;line-height:1.4}',
      '.body,.f{position:relative}',
      '.frame{--font-ko:"Noto Sans KR","Noto Sans CJK KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif;--font-ja:"Noto Sans JP","Noto Sans CJK JP","Hiragino Sans","Yu Gothic",sans-serif;--font-zh:"Noto Sans SC","Noto Sans CJK SC","PingFang SC","Microsoft YaHei",sans-serif}',
      '.frame [lang|="ko"]{font-family:var(--font-ko)}.frame [lang|="ja"]{font-family:var(--font-ja)}.frame [lang|="zh"]{font-family:var(--font-zh)}',
      '.s:is([lang|="ko"],[lang|="ja"],[lang|="zh"]){font-size:36px;font-weight:700;font-style:normal;letter-spacing:0}',
      '.frame[data-family="crystal"] .s:is([lang|="ko"],[lang|="ja"],[lang|="zh"]){font-style:normal;font-weight:900}',
      '.lang-line{display:flex;align-items:center;gap:6px;margin-bottom:8px;color:var(--accent-text);font-size:11.5px;font-weight:600;line-height:1.3}.lang-line svg{flex:none}.lang-line strong{font-weight:700}',
      '.frame[data-family="crystal"] .lang-line{color:var(--holo);font-family:var(--sf-font-display);font-style:italic;font-weight:800;letter-spacing:.04em}',
      '.ctx{color:var(--text2)}.q{color:var(--strong);font-weight:500}.q strong{font-weight:800}',
      '.n{color:var(--text3);font-size:11px;line-height:1.3}',
      '.speak[data-kind="action"]{gap:7px}',
      '.wings{position:absolute;inset:0;overflow:hidden;pointer-events:none}',
      '.wings svg{position:absolute;right:-80px;top:-60px;width:300px;height:200px;overflow:visible;opacity:.18;transform:scaleX(-1) rotate(-10deg)}',
      '.lumi{flex:none;width:46px;height:46px;margin:-6px -6px -8px 0;background:var(--chip);clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%)}',
      '.lumi img{display:block;width:100%;height:100%;object-fit:contain;object-position:50% 100%;-webkit-mask-image:linear-gradient(180deg,#000 80%,transparent 99%);mask-image:linear-gradient(180deg,#000 80%,transparent 99%);filter:drop-shadow(0 0 16px rgb(94 242 255/.35));pointer-events:none}',
      '.f{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:12px 20px 16px;border-top:1px solid var(--line)}',
      '.frame[data-family="crystal"] .f{border-top:0;box-shadow:inset 0 1px 0 var(--line)}',
      '.ok{min-height:32px;display:inline-flex;align-items:center;gap:6px;padding:0 12px;border:1px solid var(--ok-line);border-radius:999px;background:var(--ok-bg);color:var(--ok);font-size:12.5px;font-weight:650}',
      '.ok:not([data-tone="translated"])::before{content:"";width:9px;height:5px;margin:-3px 2px 0 0;border-left:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(-45deg)}',
      '.ok[data-tone="existing"]{border-color:var(--warn-line);background:var(--warn-bg);color:var(--warn)}',
      '.ok[data-tone="translated"]{border-color:var(--line);background:var(--chip);color:var(--text2)}',
      '.frame[data-family="crystal"] .ok{border:0;border-radius:0;box-shadow:inset 0 0 0 1px var(--ok-line);font-family:var(--sf-font-display);font-style:italic;font-weight:800;clip-path:polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%,0 10px)}',
      '.meta{margin-left:auto;display:flex;flex-direction:column;align-items:flex-end;gap:2px;text-align:right}',
      '.b{color:var(--text3);font-family:var(--sf-font-mono);font-size:11px;letter-spacing:.02em}',
      '.m{color:var(--accent-text);font-size:10.5px;font-weight:700;letter-spacing:.08em}',
      '.frame[data-family="crystal"] .m{color:var(--holo);font-family:var(--sf-font-display);font-style:italic;font-weight:800;letter-spacing:.1em}',
      '.err{margin-top:12px;padding:10px 12px;border:1px solid var(--danger-line);border-radius:12px;background:var(--danger-bg);color:var(--danger);font-size:13px}',
      '.err[data-tone="quota"]{border-color:var(--warn-line);background:var(--warn-bg);color:var(--warn)}',
      '.frame[data-family="crystal"] .err{border:0;border-radius:0;box-shadow:inset 3px 0 0 currentColor}',
      '.quota-note{margin-top:8px;color:var(--text2);font-size:12px}',
      '.load{margin-top:12px;display:flex;align-items:center;color:var(--text2);font-size:13px}',
      '.spin{display:inline-block;width:14px;height:14px;margin-right:8px;border:2px solid var(--accent-soft);border-top-color:var(--accent);border-radius:50%;animation:r .8s linear infinite}',
      '@keyframes r{to{transform:rotate(360deg)}}',
      '@media (prefers-reduced-motion: reduce){.spin{animation:none}.c{animation:none}.x{transition:none}.speak{transition:none}}',
    ].join('');
    const frame = document.createElement('div'); frame.className = 'frame';
    frame.dataset.family = family; frame.dataset.scheme = scheme;
    const caret = document.createElement('span'); caret.className = 'caret'; caret.setAttribute('aria-hidden', 'true');
    const card = document.createElement('section'); card.className = 'c'; card.setAttribute('role', 'status'); card.setAttribute('aria-live', 'polite');
    const body = document.createElement('div'); body.className = 'body';
    const foot = document.createElement('div'); foot.className = 'f';
    const meta = document.createElement('div'); meta.className = 'meta';
    const head = document.createElement('div'); head.className = 'h';
    const info = document.createElement('div'); info.className = 'info';
    const brand = document.createElement('div'); brand.className = 'b'; brand.textContent = payload.version ? bt('bubbleBrand', [payload.version], `SONFLASH v${payload.version}`) : bt('bubbleBrandNoVersion', undefined, 'SONFLASH');
    const source = document.createElement('div'); source.className = 's'; source.textContent = payload.text || '';
    if (wordLanguage) source.setAttribute('lang', wordLanguage);
    const sourceLine = document.createElement('div'); sourceLine.className = 'source-line';
    const sourceFallback = payload.text || bt('bubbleDefaultWordFallback', undefined, 'từ đã chọn');
    const sourceSpeaker = speechButtonInPage(payload.text || '', bt('bubbleSpeakSelectionLabel', [sourceFallback], `Nghe phát âm ${sourceFallback}`), payload.speechLocale);
    sourceLine.append(source, sourceSpeaker);
    const lineLanguage = pageLanguage && pageLanguage === detectedLanguage ? pageLanguage : detectedLanguage;
    if (languageMode && lineLanguage && payload.status === 'translated') {
      const languageLine = document.createElement('div'); languageLine.className = 'lang-line';
      const globe = svgIconInPage('globe');
      if (globe) languageLine.append(globe);
      const name = document.createElement('strong'); name.setAttribute('lang', lineLanguage); name.textContent = autonymInPage(lineLanguage);
      languageLine.append(
        document.createTextNode(`${lineLanguage === pageLanguage ? bt('bubblePageLanguage', undefined, 'Trang bằng') : bt('bubbleSelectionLanguage', undefined, 'Đoạn chọn bằng')} `),
        name,
        document.createTextNode(` · ${bt('bubbleDetected', undefined, 'tự nhận diện')}`),
      );
      info.append(languageLine);
    }
    info.append(sourceLine);
    if (!speechSupportedInPage()) {
      const speechHelp = document.createElement('div');
      speechHelp.id = speechStatusId;
      speechHelp.className = 'speech-help';
      speechHelp.setAttribute('role', 'status');
      speechHelp.setAttribute('aria-live', 'polite');
      speechHelp.textContent = bt('bubbleSpeechUnsupported', undefined, 'Trình duyệt này không hỗ trợ phát âm.');
      info.append(speechHelp);
    }

    const close = document.createElement('button'); close.className = 'x'; close.type = 'button'; close.setAttribute('aria-label', bt('bubbleCloseAriaLabel', undefined, 'Đóng kết quả SonFlash'));
    const closeIcon = svgIconInPage('close');
    if (closeIcon) close.append(closeIcon);
    else close.textContent = 'Đóng';
    close.onclick = () => host.remove();
    head.append(info, close); body.append(head);
    if (String(payload.status).startsWith('loading')) {
      const line = document.createElement('div'); line.className = 'load'; line.setAttribute('role', 'status'); line.setAttribute('aria-live', 'polite');
      const spinner = document.createElement('span'); spinner.className = 'spin'; spinner.setAttribute('aria-hidden', 'true');
      line.append(spinner, document.createTextNode(payload.status === 'loading-save' ? bt('bubbleLoadingSave', undefined, 'Đang tạo và lưu flashcard…') : bt('bubbleLoadingTranslate', undefined, 'Đang dịch nhanh…'))); body.append(line);
    } else if (['translated','created','existing'].includes(payload.status)) {
      const romanization = typeof payload.romanization === 'string' ? payload.romanization.trim() : '';
      const reading = payload.phonetic || (romanization && romanization.toLowerCase() !== String(payload.text || '').trim().toLowerCase() ? romanization : '');
      if (reading) { const p = document.createElement('div'); p.className = 'p'; p.textContent = reading; body.append(p); }
      const text = document.createElement('div'); text.className = 't'; text.textContent = payload.translation || bt('bubbleResult', undefined, 'Đã xử lý'); body.append(text);
      if (payload.explanation) { const e = document.createElement('div'); e.className = 'e'; e.textContent = payload.explanation; body.append(e); }
      const pageContext = payload.status === 'translated' && typeof payload.context === 'string' ? payload.context.replace(/\s+/g, ' ').trim() : '';
      if (pageContext) {
        const word = String(payload.text || '').trim();
        const index = word ? pageContext.indexOf(word) : -1;
        // A short window around the word, trimmed to whole words where the
        // text has spaces, as the boards quote it.
        let start = index < 0 ? 0 : Math.max(0, index - 24);
        let end = index < 0 ? Math.min(pageContext.length, 96) : Math.min(pageContext.length, index + word.length + 24);
        if (index >= 0 && start > 0) { const space = pageContext.indexOf(' ', start); if (space >= 0 && space < index) start = space + 1; }
        if (index >= 0 && end < pageContext.length) { const space = pageContext.lastIndexOf(' ', end); if (space > index + word.length) end = space; }
        const excerpt = document.createElement('span'); excerpt.className = 'q';
        if (wordLanguage) excerpt.setAttribute('lang', wordLanguage);
        if (index < 0) excerpt.append(document.createTextNode(`${pageContext.slice(start, end)}${end < pageContext.length ? '…' : ''}`));
        else {
          const strong = document.createElement('strong'); strong.textContent = pageContext.slice(index, index + word.length);
          excerpt.append(
            document.createTextNode(`${start > 0 ? '…' : ''}${pageContext.slice(start, index)}`),
            strong,
            document.createTextNode(`${pageContext.slice(index + word.length, end)}${end < pageContext.length ? '…' : ''}`),
          );
        }
        const contextBox = document.createElement('div'); contextBox.className = 'example';
        const contextLine = document.createElement('div'); contextLine.className = 'e ctx';
        contextLine.append(document.createTextNode(`${bt('bubbleInArticle', undefined, 'Trong bài:')} “`), excerpt, document.createTextNode('”'));
        contextBox.append(contextLine);
        body.append(contextBox);
      }
      if (payload.exampleSentence || payload.exampleTranslation) {
        const example = document.createElement('div'); example.className = 'example';
        if (payload.exampleSentence) {
          const exampleLine = document.createElement('div'); exampleLine.className = 'example-line';
          const e = document.createElement('div'); e.className = 'e'; e.textContent = bt('bubbleExamplePrefix', [payload.exampleSentence], `Ví dụ: ${payload.exampleSentence}`);
          exampleLine.append(e, speechButtonInPage(payload.exampleSentence, bt('bubbleSpeakExampleLabel', undefined, 'Nghe phát âm câu ví dụ'), payload.speechLocale));
          example.append(exampleLine);
        }
        if (payload.exampleTranslation) { const e = document.createElement('div'); e.className = 'e'; e.textContent = bt('bubbleExampleTranslationPrefix', [payload.exampleTranslation], `Dịch ví dụ: ${payload.exampleTranslation}`); example.append(e); }
        body.append(example);
      }
      if (payload.aiGenerated) { const disclosure = document.createElement('div'); disclosure.className = 'ai-note'; disclosure.textContent = bt('bubbleAiDisclosure', undefined, 'Nội dung do AI tạo, có thể sai. Hãy kiểm tra nghĩa.'); body.append(disclosure); }
      // A quick translation can be saved from the bubble when a course is
      // confirmed and the selection is in that course's language. The click
      // must come from the user: the shadow root is open, so a page script
      // could otherwise press the button and spend an AI request.
      const saveOffered = payload.status === 'translated' && Boolean(courseLanguage)
        && typeof payload.saveId === 'string' && Boolean(payload.saveId) && Boolean(String(payload.text || '').trim());
      if (saveOffered) {
        const save = document.createElement('button');
        save.type = 'button'; save.className = 'speak'; save.dataset.kind = 'action'; save.dataset.role = 'save';
        const renderSaveLabel = () => {
          const parts = [];
          const icon = svgIconInPage('plus');
          if (icon) parts.push(icon);
          if (languageMode) {
            const name = document.createElement('span'); name.setAttribute('lang', courseLanguage); name.textContent = autonymInPage(courseLanguage);
            parts.push(document.createTextNode(`${bt('bubbleSaveTo', undefined, 'Lưu vào')} `), name);
          } else parts.push(document.createTextNode(bt('bubbleSaveFlashcard', undefined, 'Lưu flashcard')));
          save.replaceChildren(...parts);
        };
        renderSaveLabel();
        let saveError = null;
        save.onmousedown = event => event?.preventDefault?.();
        save.onclick = event => {
          if (event?.isTrusted !== true || save.disabled) return;
          const runtime = (globalThis.browser ?? globalThis.chrome)?.runtime;
          if (!runtime?.sendMessage) return;
          save.disabled = true;
          save.textContent = bt('bubbleSaving', undefined, 'Đang bắt đầu lưu…');
          const finish = response => {
            // On success the background replaces this bubble with the save's progress.
            if (response?.ok === true) return;
            save.disabled = false;
            renderSaveLabel();
            if (!saveError) {
              saveError = document.createElement('div'); saveError.className = 'err'; saveError.setAttribute('role', 'alert');
              body.append(saveError);
            }
            saveError.textContent = response?.error || runtime.lastError?.message || bt('bubbleSaveFailed', undefined, 'Không thể lưu từ này. Hãy thử lại.');
          };
          try {
            const message = { type: 'INLINE_SELECTION_ADD', id: payload.saveId };
            if (globalThis.browser?.runtime) void runtime.sendMessage(message).then(finish, error => finish({ error: error?.message }));
            else runtime.sendMessage(message, finish);
          } catch (error) { finish({ error: error?.message }); }
        };
        foot.append(save);
        meta.dataset.save = 'true';
      } else {
        const ok = document.createElement('div'); ok.className = 'ok';
        if (payload.status === 'existing') ok.dataset.tone = 'existing';
        else if (payload.status === 'translated') ok.dataset.tone = 'translated';
        ok.textContent = (payload.status === 'translated' ? bt('bubbleTranslatedOnly', undefined, 'Chỉ dịch • không lưu • không dùng quota AI') : payload.status === 'existing' ? bt('bubbleExisting', undefined, 'Đã có trong thư viện') : bt('bubbleCreated', undefined, 'Đã thêm vào thư viện'));
        foot.append(ok);
      }
    } else {
      const isQuota = payload.status === 'error' && isQuotaMessageInPage(payload.message);
      const e = document.createElement('div'); e.className = payload.status === 'auth-required' ? 'e' : 'err';
      if (isQuota) e.dataset.tone = 'quota';
      if (payload.status === 'auth-required') {
        e.append(document.createTextNode(bt('bubbleAuthRequired', undefined, 'Cần đăng nhập SonFlash để hoàn tất. ')));
        try {
          const login = new URL(payload.loginUrl || '');
          if (login.origin === 'https://encoded-hangout-433912-h2.web.app') {
            const link = document.createElement('a'); link.href = login.toString(); link.target = '_blank'; link.rel = 'noopener'; link.textContent = bt('bubbleAuthLink', undefined, 'Đăng nhập / mở thư viện'); e.append(link);
          }
        } catch {}
      } else e.textContent = payload.message || bt('bubbleGenericError', undefined, 'Không thể xử lý. Hãy thử lại.');
      body.append(e);
      if (isQuota) {
        const note = document.createElement('div'); note.className = 'quota-note'; note.textContent = bt('bubbleQuotaNote', undefined, 'Dịch nhanh vẫn miễn phí, không dùng lượt AI.');
        body.append(note);
        const openApp = document.createElement('button');
        openApp.type = 'button'; openApp.className = 'speak'; openApp.dataset.kind = 'action'; openApp.textContent = bt('bubbleQuotaAction', undefined, 'Mở SonFlash · Nâng cấp Pro');
        openApp.onclick = () => {
          const runtime = (globalThis.browser ?? globalThis.chrome)?.runtime;
          if (!runtime?.sendMessage) return;
          const message = { type: 'OPEN_APP' };
          if (globalThis.browser?.runtime) void runtime.sendMessage(message);
          else runtime.sendMessage(message, () => {});
        };
        foot.append(openApp);
      } else if (payload.status === 'error' && typeof payload.retryId === 'string') {
        const retry = document.createElement('button');
        retry.type = 'button'; retry.className = 'speak'; retry.dataset.kind = 'action'; retry.textContent = bt('bubbleRetry', undefined, 'Thử lại từ này');
        retry.onclick = () => {
          const runtime = (globalThis.browser ?? globalThis.chrome)?.runtime;
          if (!runtime?.sendMessage) return;
          retry.disabled = true;
          retry.textContent = bt('bubbleRetrying', undefined, 'Đang thử lại…');
          const finish = response => {
            if (response?.ok === true) return;
            retry.disabled = false;
            retry.textContent = bt('bubbleRetry', undefined, 'Thử lại từ này');
            e.textContent = response?.error || runtime.lastError?.message || bt('bubbleRetryFailed', undefined, 'Không thể thử lại. Hãy mở extension và chọn từ lần nữa.');
          };
          try {
            const message = { type: 'RETRY_QUICK_ADD', id: payload.retryId };
            if (globalThis.browser?.runtime) {
              void runtime.sendMessage(message).then(finish, error => finish({ error: error?.message }));
            } else {
              runtime.sendMessage(message, finish);
            }
          } catch (error) { finish({ error: error?.message }); }
        };
        foot.append(retry);
      }
    }
    if (meta.dataset.save === 'true') {
      // Beside the Save button the boards name the language of the meanings
      // for a language course, and the AI request a save costs otherwise.
      const meaningsLanguage = languageCodeInPage(payload.translationLanguage) || nativeLanguage;
      if (languageMode && meaningsLanguage) {
        const meanings = document.createElement('div'); meanings.className = 'n';
        const name = document.createElement('span'); name.setAttribute('lang', meaningsLanguage); name.textContent = autonymInPage(meaningsLanguage);
        meanings.append(document.createTextNode(bt('bubbleMeaningsIn', undefined, 'Nghĩa bằng')), document.createElement('br'), name);
        meta.append(meanings);
      } else {
        const cost = document.createElement('div'); cost.className = 'b'; cost.textContent = bt('bubbleSaveCost', undefined, '1 lượt AI');
        meta.append(cost);
      }
    } else {
      if (payload.modeLabel) { const mode = document.createElement('span'); mode.className = 'm'; mode.textContent = payload.modeLabel; meta.append(mode); }
      meta.append(brand);
    }
    foot.append(meta);
    if (family === 'crystal') {
      foot.append(crystalLumiInPage());
      const wings = crystalWingsInPage();
      if (wings) {
        const wingsLayer = document.createElement('div');
        wingsLayer.className = 'wings';
        wingsLayer.setAttribute('aria-hidden', 'true');
        wingsLayer.append(wings);
        card.append(wingsLayer);
      }
    }
    card.append(body, foot);
    frame.append(caret, card);
    root.append(style, frame);
    if (payload.autoSpeak && ['translated', 'created', 'existing'].includes(payload.status)) {
      speakTextInPage(payload.text || '', payload.speechLocale, sourceSpeaker, `Nghe phát âm ${payload.text || 'từ đã chọn'}`);
    }
    const a = payload.anchor, vw = Math.max(document.documentElement.clientWidth || 0, innerWidth || 0), vh = Math.max(document.documentElement.clientHeight || 0, innerHeight || 0);
    host.style.left = `${a ? Math.min(Math.max(12, Number(a.left)||12), Math.max(12,vw-bubbleWidth-12)) : Math.max(12,vw-bubbleWidth-12)}px`;
    const measuredHeight = Number(card.getBoundingClientRect?.().height) || 190;
    const cardHeight = Math.min(measuredHeight, Math.max(0, vh - 24));
    const desiredTop = a ? (Number(a.bottom) || 0) + 10 : 16;
    const top = Math.min(Math.max(12, desiredTop), Math.max(12, vh - cardHeight - 12));
    host.style.top = `${top}px`;
    // The caret points back at the selection only while the bubble sits directly below it.
    caret.hidden = !(a && top === desiredTop);
    const duration = Number.isSafeInteger(payload.bubbleDurationMs) ? Math.max(0, payload.bubbleDurationMs) : 12_000;
    if (duration > 0 && ['translated','created','existing'].includes(payload.status)) setTimeout(() => host.isConnected && host.remove(), duration);
    return { ok: true };
  };

  globalThis.LingoFlashExtensionUi = Object.freeze({ captureSelectionFromPage, renderInlineBubble });
})();
