'use strict';

importScripts('shared.js');

const {
  extensionApi,
  usesPromiseApi,
  apiCall,
  buildImportUrl,
  readConfiguredAppUrl,
  selectionValidation,
  validateAppUrl,
  DEFAULT_APP_URL,
} = globalThis.LingoFlashExtension;

const CONTEXT_MENU_ID = 'lingoflash-translate-selection';
const COMMAND_ID = 'translate-selection';

const createContextMenu = async () => {
  try {
    await apiCall(extensionApi.contextMenus, 'create', {
      id: CONTEXT_MENU_ID,
      title: 'Dịch và thêm “%s” vào LingoFlash',
      contexts: ['selection'],
    });
  } catch {
    // The popup and keyboard shortcut remain available when a platform omits context menus.
  }
};

const installContextMenu = () => {
  if (!extensionApi.contextMenus) return;
  void (async () => {
    try {
      await apiCall(extensionApi.contextMenus, 'removeAll');
    } catch {
      // A missing previous menu is harmless.
    }
    await createContextMenu();
  })();
};

const selectionFromPage = () => {
  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    const start = active.selectionStart;
    const end = active.selectionEnd;
    if (typeof start === 'number' && typeof end === 'number' && end > start) {
      return active.value.slice(start, end);
    }
  }
  return globalThis.getSelection?.()?.toString() ?? '';
};

const getActiveTab = async () => {
  const tabs = await apiCall(extensionApi.tabs, 'query', { active: true, currentWindow: true });
  return Array.isArray(tabs) ? tabs[0] ?? null : null;
};

const getSelectedText = async (tabId, suppliedText = '') => {
  if (suppliedText) return suppliedText;
  if (typeof tabId !== 'number') throw new Error('Không tìm thấy tab đang hoạt động.');
  const injections = await apiCall(extensionApi.scripting, 'executeScript', {
    target: { tabId },
    func: selectionFromPage,
  });
  return Array.isArray(injections) ? injections[0]?.result ?? '' : '';
};

const showPageNotice = async (tabId, message) => {
  if (typeof tabId !== 'number') return;
  try {
    await apiCall(extensionApi.scripting, 'executeScript', {
      target: { tabId },
      func: text => {
        const previous = document.getElementById('lingoflash-extension-notice');
        previous?.remove();
        const host = document.createElement('div');
        host.id = 'lingoflash-extension-notice';
        host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;right:20px;top:20px;max-width:360px;';
        const root = host.attachShadow({ mode: 'closed' });
        const notice = document.createElement('div');
        notice.textContent = text;
        notice.setAttribute('role', 'status');
        notice.style.cssText = [
          'font:600 14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
          'color:#f8fafc',
          'background:#111827',
          'border:1px solid rgba(103,232,249,.45)',
          'border-radius:14px',
          'padding:12px 14px',
          'box-shadow:0 16px 50px rgba(15,23,42,.35)',
        ].join(';');
        root.append(notice);
        document.documentElement.append(host);
        setTimeout(() => host.remove(), 3200);
      },
      args: [message],
    });
  } catch {
    try {
      await apiCall(extensionApi.action, 'setBadgeText', { text: '!' });
      globalThis.setTimeout(() => {
        void apiCall(extensionApi.action, 'setBadgeText', { text: '' }).catch(() => undefined);
      }, 3000);
    } catch {
      // Restricted browser pages cannot be modified; the popup still surfaces errors.
    }
  }
};

const openApp = async appUrl => {
  const validated = validateAppUrl(appUrl ?? await readConfiguredAppUrl());
  const url = validated.ok ? validated.url : DEFAULT_APP_URL;
  await apiCall(extensionApi.tabs, 'create', { url, active: true });
  return { url };
};

const translateAndAdd = async ({ tabId, suppliedText = '' } = {}) => {
  const rawText = await getSelectedText(tabId, suppliedText);
  const validation = selectionValidation(rawText);
  if (!validation.ok) throw new Error(validation.error);
  const appUrl = await readConfiguredAppUrl();
  const importUrl = buildImportUrl(appUrl, validation.text);
  await apiCall(extensionApi.tabs, 'create', { url: importUrl, active: true });
  return { text: validation.text, url: importUrl };
};

const currentShortcut = async () => {
  try {
    const commands = await apiCall(extensionApi.commands, 'getAll');
    const command = Array.isArray(commands)
      ? commands.find(candidate => candidate.name === COMMAND_ID)
      : null;
    return command?.shortcut || '';
  } catch {
    return '';
  }
};

extensionApi.runtime?.onInstalled?.addListener(installContextMenu);
extensionApi.runtime?.onStartup?.addListener(installContextMenu);
installContextMenu();

extensionApi.contextMenus?.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID) return;
  void translateAndAdd({ tabId: tab?.id, suppliedText: info.selectionText ?? '' })
    .catch(error => showPageNotice(tab?.id, error.message));
});

extensionApi.commands?.onCommand?.addListener((command, commandTab) => {
  if (command !== COMMAND_ID) return;
  void (async () => {
    const tab = commandTab?.id ? commandTab : await getActiveTab();
    try {
      await translateAndAdd({ tabId: tab?.id });
    } catch (error) {
      await showPageNotice(tab?.id, error instanceof Error ? error.message : String(error));
    }
  })();
});

const handleRuntimeMessage = async message => {
  const type = message && typeof message === 'object' ? message.type : '';
  if (type === 'GET_SELECTION') {
    const tab = await getActiveTab();
    return { ok: true, text: await getSelectedText(tab?.id) };
  }
  if (type === 'ADD_SELECTION') {
    const tab = await getActiveTab();
    return { ok: true, ...await translateAndAdd({ tabId: tab?.id, suppliedText: message.text ?? '' }) };
  }
  if (type === 'OPEN_APP') return { ok: true, ...await openApp() };
  if (type === 'GET_SHORTCUT') return { ok: true, shortcut: await currentShortcut() };
  throw new Error('Yêu cầu extension không được hỗ trợ.');
};

extensionApi.runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
  const response = handleRuntimeMessage(message).catch(error => ({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }));

  if (usesPromiseApi) return response;
  response.then(sendResponse);
  return true;
});
