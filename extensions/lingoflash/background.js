'use strict';

importScripts('shared.js');

const {
  APP_ORIGIN,
  DEFAULT_APP_URL,
  extensionApi,
  transientStorage,
  usesPromiseApi,
  apiCall,
  buildImportUrl,
  createIntentId,
  readConfiguredAppUrl,
  selectionValidation,
  validateAppUrl,
} = globalThis.LingoFlashExtension;

const CONTEXT_TRANSLATE_ID = 'lingoflash-translate-only';
const CONTEXT_SAVE_ID = 'lingoflash-translate-save';
const SAVE_COMMAND_ID = 'translate-selection';
const TRANSLATE_COMMAND_ID = 'translate-only-selection';
const JOB_KEY_PREFIX = 'lingoflash_quick_add_job_';
const JOB_ALARM_PREFIX = 'lingoflash_quick_add_timeout_';
const JOB_TIMEOUT_MINUTES = 0.5;
const APP_RESULT_MESSAGE = 'LINGOFLASH_EXTENSION_RESULT';

const boundedText = (value, maximum) => typeof value === 'string'
  ? value.trim().slice(0, maximum)
  : '';

const jobKey = id => `${JOB_KEY_PREFIX}${id}`;
const alarmName = id => `${JOB_ALARM_PREFIX}${id}`;
const saveJob = job => apiCall(transientStorage, 'set', { [jobKey(job.id)]: job });

const readJob = async id => {
  const values = await apiCall(transientStorage, 'get', jobKey(id));
  return values?.[jobKey(id)] ?? null;
};

const removeJob = async id => {
  try { await apiCall(transientStorage, 'remove', jobKey(id)); } catch {}
};

const readAllJobs = async () => {
  try {
    const values = await apiCall(transientStorage, 'get', null);
    return Object.entries(values ?? {})
      .filter(([key, value]) => key.startsWith(JOB_KEY_PREFIX) && value && typeof value === 'object')
      .map(([, value]) => value);
  } catch {
    return [];
  }
};

const createJobAlarm = id => {
  try { extensionApi.alarms?.create(alarmName(id), { delayInMinutes: JOB_TIMEOUT_MINUTES }); } catch {}
};

const clearJobAlarm = async id => {
  try { await apiCall(extensionApi.alarms, 'clear', alarmName(id)); } catch {}
};

const installContextMenu = () => {
  if (!extensionApi.contextMenus) return;
  void (async () => {
    try { await apiCall(extensionApi.contextMenus, 'removeAll'); } catch {}
    try {
      await apiCall(extensionApi.contextMenus, 'create', {
        id: CONTEXT_TRANSLATE_ID,
        title: 'Dịch nhanh “%s” — không lưu',
        contexts: ['selection'],
      });
      await apiCall(extensionApi.contextMenus, 'create', {
        id: CONTEXT_SAVE_ID,
        title: 'Dịch + thêm “%s” vào LingoFlash',
        contexts: ['selection'],
      });
    } catch {}
  })();
};

const captureSelectionFromPage = () => {
  const normalizeRect = rect => {
    if (!rect || (!rect.width && !rect.height)) return null;
    return {
      left: Number(rect.left) || 0,
      top: Number(rect.top) || 0,
      right: Number(rect.right) || 0,
      bottom: Number(rect.bottom) || 0,
      width: Number(rect.width) || 0,
      height: Number(rect.height) || 0,
    };
  };

  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    const start = active.selectionStart;
    const end = active.selectionEnd;
    if (typeof start === 'number' && typeof end === 'number' && end > start) {
      return {
        text: active.value.slice(start, end),
        anchor: normalizeRect(active.getBoundingClientRect()),
      };
    }
  }

  const selection = globalThis.getSelection?.();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return { text: '', anchor: null };
  }
  const range = selection.getRangeAt(0);
  return {
    text: selection.toString(),
    anchor: normalizeRect(range.getBoundingClientRect()),
  };
};

const translateWithChromeTranslator = async text => {
  try {
    if (!('Translator' in globalThis)) {
      return {
        ok: false,
        code: 'unsupported',
        message: 'Dịch nhanh cần Chrome 138+ trên máy tính. Hãy cập nhật Chrome hoặc dùng “Dịch + thêm”.',
      };
    }

    const options = { sourceLanguage: 'en', targetLanguage: 'vi' };
    const availability = typeof globalThis.Translator.availability === 'function'
      ? await globalThis.Translator.availability(options)
      : 'available';

    if (availability === 'unavailable') {
      return {
        ok: false,
        code: 'unavailable',
        message: 'Chrome Translator chưa hỗ trợ cặp Anh → Việt trên thiết bị này.',
      };
    }

    let progress = 1;
    const translator = await globalThis.Translator.create({
      ...options,
      monitor(monitor) {
        monitor.addEventListener('downloadprogress', event => {
          progress = Number.isFinite(event.loaded) ? event.loaded : progress;
        });
      },
    });
    const translation = String(await translator.translate(text)).trim();
    translator.destroy?.();

    if (!translation) throw new Error('Chrome Translator trả về kết quả trống.');
    return { ok: true, translation, progress };
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    const isActivationError = name === 'NotAllowedError';
    return {
      ok: false,
      code: isActivationError ? 'activation-required' : 'failed',
      message: isActivationError
        ? 'Chrome cần quyền khởi tạo bộ dịch cục bộ. Hãy thử lại bằng phím tắt hoặc menu chuột phải trên tab đang đọc.'
        : (error instanceof Error ? error.message : 'Chrome Translator không thể dịch đoạn này.'),
    };
  }
};

const renderInlineTranslation = payload => {
  const HOST_ID = 'lingoflash-inline-translation-host';
  let host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = [
      'all:initial',
      'position:fixed',
      'z-index:2147483647',
      'width:min(380px,calc(100vw - 24px))',
      'max-width:380px',
      'pointer-events:auto',
    ].join(';');
    host.attachShadow({ mode: 'open' });
    document.documentElement.append(host);
  }

  const root = host.shadowRoot;
  if (!root) return;
  root.replaceChildren();

  const style = document.createElement('style');
  style.textContent = `
    :host { color-scheme: dark; }
    * { box-sizing: border-box; }
    .card { position:relative; overflow:hidden; border:1px solid rgba(103,232,249,.38); border-radius:16px; padding:14px 15px 13px; color:#f8fafc; background:linear-gradient(145deg,rgba(7,17,31,.98),rgba(15,23,42,.98)); box-shadow:0 22px 70px rgba(2,6,23,.36),inset 0 1px rgba(255,255,255,.04); font:500 13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; backdrop-filter:blur(18px); }
    .glow { position:absolute; inset:-70px auto auto -70px; width:150px; height:150px; border-radius:999px; background:rgba(34,211,238,.12); filter:blur(10px); pointer-events:none; }
    .top { position:relative; display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
    .brand { color:#67e8f9; font-size:10px; font-weight:800; letter-spacing:.14em; }
    .source { margin-top:3px; color:#94a3b8; font-size:12px; overflow-wrap:anywhere; }
    .mode { display:inline-flex; margin-top:7px; padding:3px 7px; border-radius:999px; color:#a5f3fc; background:rgba(34,211,238,.09); font-size:10px; font-weight:700; }
    .close { appearance:none; border:0; padding:1px 4px; color:#94a3b8; background:transparent; cursor:pointer; font:700 18px/1 sans-serif; }
    .close:hover { color:#f8fafc; }
    .translation { margin-top:10px; color:#f8fafc; font-size:20px; font-weight:760; line-height:1.22; overflow-wrap:anywhere; }
    .phonetic { margin-top:3px; color:#67e8f9; font-size:12px; }
    .explanation { margin-top:9px; color:#cbd5e1; font-size:12px; }
    .example { margin-top:9px; padding:9px 10px; border-radius:10px; color:#cbd5e1; background:rgba(30,41,59,.68); font-size:11px; }
    .example strong { display:block; margin-top:3px; color:#94a3b8; font-weight:500; }
    .footer { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:11px; color:#94a3b8; font-size:11px; }
    .badge { display:inline-flex; align-items:center; gap:6px; color:#86efac; font-weight:700; }
    .badge.free { color:#67e8f9; }
    .dot { width:7px; height:7px; border-radius:999px; background:#4ade80; box-shadow:0 0 12px rgba(74,222,128,.65); }
    .free .dot { background:#22d3ee; box-shadow:0 0 12px rgba(34,211,238,.65); }
    .loading { display:flex; align-items:center; gap:10px; margin-top:12px; color:#cbd5e1; }
    .spinner { width:17px; height:17px; border:2px solid rgba(103,232,249,.2); border-top-color:#67e8f9; border-radius:999px; animation:spin .8s linear infinite; }
    .message { margin-top:10px; color:#cbd5e1; }
    .error { color:#fca5a5; }
    .auth-link { display:inline-flex; margin-top:11px; border-radius:10px; padding:8px 10px; color:#04202a; background:#67e8f9; text-decoration:none; font-weight:800; }
    @keyframes spin { to { transform:rotate(360deg); } }
  `;

  const card = document.createElement('section');
  card.className = 'card';
  card.setAttribute('role', payload.status?.startsWith('loading') ? 'status' : 'dialog');
  card.setAttribute('aria-label', 'LingoFlash translation');

  const glow = document.createElement('span');
  glow.className = 'glow';
  card.append(glow);

  const top = document.createElement('div');
  top.className = 'top';
  const heading = document.createElement('div');
  const brand = document.createElement('div');
  brand.className = 'brand';
  brand.textContent = 'LINGOFLASH';
  const source = document.createElement('div');
  source.className = 'source';
  source.textContent = payload.text || '';
  heading.append(brand, source);

  if (payload.modeLabel) {
    const mode = document.createElement('span');
    mode.className = 'mode';
    mode.textContent = payload.modeLabel;
    heading.append(mode);
  }

  const close = document.createElement('button');
  close.className = 'close';
  close.type = 'button';
  close.setAttribute('aria-label', 'Đóng');
  close.textContent = '×';
  close.addEventListener('click', () => host.remove());
  top.append(heading, close);
  card.append(top);

  if (payload.status === 'loading-translate' || payload.status === 'loading-save') {
    const loading = document.createElement('div');
    loading.className = 'loading';
    const spinner = document.createElement('span');
    spinner.className = 'spinner';
    const label = document.createElement('span');
    label.textContent = payload.status === 'loading-translate'
      ? 'Đang dịch nhanh bằng Chrome Translator…'
      : 'Đang tạo flashcard và lưu vào LingoFlash…';
    loading.append(spinner, label);
    card.append(loading);
  } else if (payload.status === 'translated' || payload.status === 'created' || payload.status === 'existing') {
    const translation = document.createElement('div');
    translation.className = 'translation';
    translation.textContent = payload.translation || 'Đã xử lý';
    card.append(translation);

    if (payload.phonetic) {
      const phonetic = document.createElement('div');
      phonetic.className = 'phonetic';
      phonetic.textContent = payload.phonetic;
      card.append(phonetic);
    }
    if (payload.explanation) {
      const explanation = document.createElement('div');
      explanation.className = 'explanation';
      explanation.textContent = payload.explanation;
      card.append(explanation);
    }
    if (payload.exampleSentence) {
      const example = document.createElement('div');
      example.className = 'example';
      example.textContent = payload.exampleSentence;
      if (payload.exampleTranslation) {
        const translatedExample = document.createElement('strong');
        translatedExample.textContent = payload.exampleTranslation;
        example.append(translatedExample);
      }
      card.append(example);
    }

    const footer = document.createElement('div');
    footer.className = 'footer';
    const badge = document.createElement('span');
    badge.className = `badge${payload.status === 'translated' ? ' free' : ''}`;
    const dot = document.createElement('span');
    dot.className = 'dot';
    const badgeText = document.createElement('span');
    badgeText.textContent = payload.status === 'translated'
      ? 'Chỉ dịch • không lưu • không dùng quota AI'
      : payload.status === 'created'
        ? 'Đã thêm vào thư viện'
        : 'Đã có trong thư viện';
    badge.append(dot, badgeText);
    const hint = document.createElement('span');
    hint.textContent = 'Tự đóng sau vài giây';
    footer.append(badge, hint);
    card.append(footer);
  } else if (payload.status === 'auth-required') {
    const message = document.createElement('div');
    message.className = 'message';
    message.textContent = 'Hãy đăng nhập LingoFlash một lần để dùng chế độ tạo + lưu flashcard.';
    const link = document.createElement('a');
    link.className = 'auth-link';
    link.href = payload.loginUrl || 'https://encoded-hangout-433912-h2.web.app/';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Mở LingoFlash để đăng nhập';
    card.append(message, link);
  } else {
    const message = document.createElement('div');
    message.className = 'message error';
    message.textContent = payload.message || 'Không thể xử lý đoạn này. Hãy thử lại.';
    card.append(message);
  }

  root.append(style, card);

  const anchor = payload.anchor && typeof payload.anchor === 'object' ? payload.anchor : null;
  const viewportWidth = Math.max(document.documentElement.clientWidth, globalThis.innerWidth || 0);
  const viewportHeight = Math.max(document.documentElement.clientHeight, globalThis.innerHeight || 0);
  const desiredLeft = anchor ? Number(anchor.left) || 12 : viewportWidth - 392;
  const desiredTop = anchor ? (Number(anchor.bottom) || 12) + 9 : 18;
  host.style.left = `${Math.max(12, Math.min(desiredLeft, viewportWidth - 392))}px`;
  host.style.top = `${Math.max(12, Math.min(desiredTop, viewportHeight - 120))}px`;

  requestAnimationFrame(() => {
    const rect = host.getBoundingClientRect();
    let topPosition = Number.parseFloat(host.style.top) || 12;
    if (topPosition + rect.height > viewportHeight - 12 && anchor) {
      topPosition = Math.max(12, (Number(anchor.top) || 12) - rect.height - 9);
    }
    const left = Math.max(12, Math.min(Number.parseFloat(host.style.left) || 12, viewportWidth - rect.width - 12));
    host.style.left = `${left}px`;
    host.style.top = `${Math.max(12, Math.min(topPosition, viewportHeight - rect.height - 12))}px`;
  });

  if (['translated', 'created', 'existing'].includes(payload.status)) {
    globalThis.setTimeout(() => host?.remove(), 9000);
  }
};

const getActiveTab = async () => {
  const tabs = await apiCall(extensionApi.tabs, 'query', { active: true, currentWindow: true });
  return Array.isArray(tabs) ? tabs[0] ?? null : null;
};

const captureSelection = async (tabId, suppliedText = '') => {
  let captured = { text: '', anchor: null };
  if (typeof tabId === 'number') {
    try {
      const injections = await apiCall(extensionApi.scripting, 'executeScript', {
        target: { tabId },
        func: captureSelectionFromPage,
      });
      captured = Array.isArray(injections) ? injections[0]?.result ?? captured : captured;
    } catch {}
  }
  return { text: suppliedText || captured.text || '', anchor: captured.anchor ?? null };
};

const showBubble = async (tabId, payload) => {
  if (typeof tabId !== 'number') return;
  try {
    await apiCall(extensionApi.scripting, 'executeScript', {
      target: { tabId },
      func: renderInlineTranslation,
      args: [payload],
    });
  } catch {}
};

const closeTab = async tabId => {
  if (typeof tabId !== 'number') return;
  try { await apiCall(extensionApi.tabs, 'remove', tabId); } catch {}
};

const openApp = async () => {
  const configured = await readConfiguredAppUrl();
  const validated = validateAppUrl(configured);
  const url = validated.ok ? validated.url : DEFAULT_APP_URL;
  await apiCall(extensionApi.tabs, 'create', { url, active: true });
  return { url };
};

const resolveSourceSelection = async ({ tabId, suppliedText = '' } = {}) => {
  const sourceTab = typeof tabId === 'number' ? { id: tabId } : await getActiveTab();
  if (typeof sourceTab?.id !== 'number') throw new Error('Không tìm thấy tab đang hoạt động.');
  const captured = await captureSelection(sourceTab.id, suppliedText);
  const validation = selectionValidation(captured.text);
  if (!validation.ok) throw new Error(validation.error);
  return { sourceTabId: sourceTab.id, text: validation.text, anchor: captured.anchor };
};

const startTranslateOnly = async input => {
  const selection = await resolveSourceSelection(input);
  await showBubble(selection.sourceTabId, {
    status: 'loading-translate',
    modeLabel: 'DỊCH NHANH • FREE',
    text: selection.text,
    anchor: selection.anchor,
  });

  try {
    const injections = await apiCall(extensionApi.scripting, 'executeScript', {
      target: { tabId: selection.sourceTabId },
      func: translateWithChromeTranslator,
      args: [selection.text],
    });
    const result = Array.isArray(injections) ? injections[0]?.result : null;
    if (!result?.ok) throw new Error(result?.message || 'Chrome Translator không thể dịch đoạn này.');
    await showBubble(selection.sourceTabId, {
      status: 'translated',
      modeLabel: 'DỊCH NHANH • FREE',
      text: selection.text,
      anchor: selection.anchor,
      translation: boundedText(result.translation, 1024),
    });
    return { text: selection.text, translation: boundedText(result.translation, 1024) };
  } catch (error) {
    await showBubble(selection.sourceTabId, {
      status: 'error',
      modeLabel: 'DỊCH NHANH • FREE',
      text: selection.text,
      anchor: selection.anchor,
      message: error instanceof Error ? error.message : 'Chrome Translator không thể dịch đoạn này.',
    });
    throw error;
  }
};

const cleanupJob = async job => {
  await Promise.all([removeJob(job.id), clearJobAlarm(job.id), closeTab(job.workerTabId)]);
};

const startQuickAdd = async input => {
  const selection = await resolveSourceSelection(input);
  const id = createIntentId();
  const job = {
    v: 1,
    id,
    text: selection.text,
    sourceTabId: selection.sourceTabId,
    workerTabId: null,
    anchor: selection.anchor,
    createdAt: Date.now(),
  };

  await showBubble(job.sourceTabId, {
    status: 'loading-save',
    modeLabel: 'TẠO + LƯU • 1 AI REQUEST',
    text: job.text,
    anchor: job.anchor,
  });
  await saveJob(job);

  try {
    const appUrl = await readConfiguredAppUrl();
    const importUrl = buildImportUrl(appUrl, job.text, {
      id,
      mode: 'silent',
      createdAt: job.createdAt,
    });
    const workerTab = await apiCall(extensionApi.tabs, 'create', { url: importUrl, active: false });
    if (typeof workerTab?.id !== 'number') throw new Error('Không thể tạo tiến trình LingoFlash ở nền.');
    job.workerTabId = workerTab.id;
    await saveJob(job);
    createJobAlarm(id);
    return { id, text: job.text };
  } catch (error) {
    await removeJob(id);
    await showBubble(job.sourceTabId, {
      status: 'error',
      modeLabel: 'TẠO + LƯU',
      text: job.text,
      anchor: job.anchor,
      message: error instanceof Error ? error.message : 'Không thể khởi động LingoFlash ở nền.',
    });
    throw error;
  }
};

const normalizeAppResult = payload => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const id = payload.id;
  const status = payload.status;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(id)) return null;
  if (!['created', 'existing', 'auth-required', 'error'].includes(status)) return null;
  return {
    id,
    status,
    word: boundedText(payload.word, 80),
    translation: boundedText(payload.translation, 256),
    phonetic: boundedText(payload.phonetic, 256),
    explanation: boundedText(payload.explanation, 1024),
    exampleSentence: boundedText(payload.exampleSentence, 1024),
    exampleTranslation: boundedText(payload.exampleTranslation, 1024),
    message: boundedText(payload.message, 512),
  };
};

const handleAppResult = async (payload, sender) => {
  const result = normalizeAppResult(payload);
  if (!result) throw new Error('Kết quả LingoFlash không hợp lệ.');
  const senderOrigin = (() => {
    try { return new URL(sender?.url || '').origin; } catch { return ''; }
  })();
  if (senderOrigin !== APP_ORIGIN) throw new Error('Nguồn kết quả LingoFlash không hợp lệ.');

  const job = await readJob(result.id);
  if (!job) return { ignored: true };
  if (typeof sender?.tab?.id !== 'number' || sender.tab.id !== job.workerTabId) {
    throw new Error('Tab trả kết quả không khớp với tác vụ LingoFlash.');
  }

  if (result.status === 'created' || result.status === 'existing') {
    await showBubble(job.sourceTabId, {
      status: result.status,
      modeLabel: 'TẠO + LƯU • 1 AI REQUEST',
      text: job.text,
      anchor: job.anchor,
      translation: result.translation,
      phonetic: result.phonetic,
      explanation: result.explanation,
      exampleSentence: result.exampleSentence,
      exampleTranslation: result.exampleTranslation,
    });
  } else if (result.status === 'auth-required') {
    await showBubble(job.sourceTabId, {
      status: 'auth-required',
      modeLabel: 'TẠO + LƯU',
      text: job.text,
      anchor: job.anchor,
      loginUrl: DEFAULT_APP_URL,
    });
  } else {
    await showBubble(job.sourceTabId, {
      status: 'error',
      modeLabel: 'TẠO + LƯU',
      text: job.text,
      anchor: job.anchor,
      message: result.message || 'Không thể tạo hoặc lưu flashcard này. Hãy thử lại.',
    });
  }

  await cleanupJob(job);
  return { ignored: false };
};

const currentShortcut = async commandId => {
  try {
    const commands = await apiCall(extensionApi.commands, 'getAll');
    const command = Array.isArray(commands) ? commands.find(candidate => candidate.name === commandId) : null;
    return command?.shortcut || '';
  } catch { return ''; }
};

const showInvocationError = async (tabId, error, text = '', anchor = null) => {
  await showBubble(tabId, {
    status: 'error',
    text,
    anchor,
    message: error instanceof Error ? error.message : String(error),
  });
};

extensionApi.runtime?.onInstalled?.addListener(installContextMenu);
extensionApi.runtime?.onStartup?.addListener(installContextMenu);
installContextMenu();

extensionApi.contextMenus?.onClicked?.addListener((info, tab) => {
  if (info.menuItemId === CONTEXT_TRANSLATE_ID) {
    void startTranslateOnly({ tabId: tab?.id, suppliedText: info.selectionText ?? '' })
      .catch(error => showInvocationError(tab?.id, error, info.selectionText ?? ''));
  } else if (info.menuItemId === CONTEXT_SAVE_ID) {
    void startQuickAdd({ tabId: tab?.id, suppliedText: info.selectionText ?? '' })
      .catch(error => showInvocationError(tab?.id, error, info.selectionText ?? ''));
  }
});

extensionApi.commands?.onCommand?.addListener((command, commandTab) => {
  if (![SAVE_COMMAND_ID, TRANSLATE_COMMAND_ID].includes(command)) return;
  void (async () => {
    const tab = commandTab?.id ? commandTab : await getActiveTab();
    try {
      if (command === TRANSLATE_COMMAND_ID) await startTranslateOnly({ tabId: tab?.id });
      else await startQuickAdd({ tabId: tab?.id });
    } catch (error) {
      await showInvocationError(tab?.id, error);
    }
  })();
});

extensionApi.alarms?.onAlarm?.addListener(alarm => {
  if (!alarm?.name?.startsWith(JOB_ALARM_PREFIX)) return;
  const id = alarm.name.slice(JOB_ALARM_PREFIX.length);
  void (async () => {
    const job = await readJob(id);
    if (!job) return;
    await showBubble(job.sourceTabId, {
      status: 'error',
      modeLabel: 'TẠO + LƯU',
      text: job.text,
      anchor: job.anchor,
      message: 'LingoFlash web không phản hồi trong 30 giây. Bridge của app có thể chưa được deploy; hãy cập nhật Hosting rồi thử lại.',
    });
    await cleanupJob(job);
  })();
});

extensionApi.tabs?.onRemoved?.addListener(tabId => {
  void (async () => {
    const jobs = await readAllJobs();
    for (const job of jobs) {
      if (job.sourceTabId === tabId) {
        await cleanupJob(job);
      } else if (job.workerTabId === tabId) {
        await showBubble(job.sourceTabId, {
          status: 'error',
          modeLabel: 'TẠO + LƯU',
          text: job.text,
          anchor: job.anchor,
          message: 'Tiến trình LingoFlash ở nền đã bị đóng trước khi hoàn tất.',
        });
        await removeJob(job.id);
        await clearJobAlarm(job.id);
      }
    }
  })();
});

const handleRuntimeMessage = async (message, sender) => {
  const type = message && typeof message === 'object' ? message.type : '';
  if (type === 'GET_SELECTION') {
    const tab = await getActiveTab();
    const captured = await captureSelection(tab?.id);
    return { ok: true, text: captured.text };
  }
  if (type === 'TRANSLATE_SELECTION') {
    const tab = await getActiveTab();
    return { ok: true, ...await startTranslateOnly({ tabId: tab?.id, suppliedText: message.text ?? '' }) };
  }
  if (type === 'ADD_SELECTION') {
    const tab = await getActiveTab();
    return { ok: true, ...await startQuickAdd({ tabId: tab?.id, suppliedText: message.text ?? '' }) };
  }
  if (type === 'OPEN_APP') return { ok: true, ...await openApp() };
  if (type === 'GET_SHORTCUT') return { ok: true, shortcut: await currentShortcut(SAVE_COMMAND_ID) };
  if (type === 'GET_SHORTCUTS') {
    return {
      ok: true,
      saveShortcut: await currentShortcut(SAVE_COMMAND_ID),
      translateShortcut: await currentShortcut(TRANSLATE_COMMAND_ID),
    };
  }
  if (type === 'APP_IMPORT_RESULT' && message.bridgeType === APP_RESULT_MESSAGE) {
    return { ok: true, ...await handleAppResult(message.payload, sender) };
  }
  throw new Error('Yêu cầu extension không được hỗ trợ.');
};

extensionApi.runtime?.onMessage?.addListener((message, sender, sendResponse) => {
  const response = handleRuntimeMessage(message, sender).catch(error => ({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }));
  if (usesPromiseApi) return response;
  response.then(sendResponse);
  return true;
});
