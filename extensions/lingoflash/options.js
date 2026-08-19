'use strict';

const {
  extensionApi,
  apiCall,
  APP_URL_STORAGE_KEY,
  DEFAULT_APP_URL,
  validateAppUrl,
} = globalThis.LingoFlashExtension;

const appUrlInput = document.getElementById('app-url');
const status = document.getElementById('status');
const shortcutValue = document.getElementById('shortcut-value');

const setStatus = (message = '', tone = '') => {
  status.textContent = message;
  if (tone) status.dataset.tone = tone;
  else delete status.dataset.tone;
};

const loadSettings = async () => {
  const values = await apiCall(extensionApi.storage.sync, 'get', {
    [APP_URL_STORAGE_KEY]: DEFAULT_APP_URL,
  });
  const validated = validateAppUrl(values?.[APP_URL_STORAGE_KEY]);
  appUrlInput.value = validated.ok ? validated.url : DEFAULT_APP_URL;

  try {
    const commands = await apiCall(extensionApi.commands, 'getAll');
    const command = commands?.find(candidate => candidate.name === 'translate-selection');
    if (command?.shortcut) shortcutValue.textContent = command.shortcut;
  } catch {
    // Suggested shortcut remains visible.
  }
};

document.getElementById('settings-form').addEventListener('submit', event => {
  event.preventDefault();
  const validated = validateAppUrl(appUrlInput.value);
  if (!validated.ok) {
    setStatus(validated.error, 'error');
    return;
  }
  void apiCall(extensionApi.storage.sync, 'set', {
    [APP_URL_STORAGE_KEY]: validated.url,
  }).then(() => {
    appUrlInput.value = validated.url;
    setStatus('Đã lưu URL ứng dụng.');
  }).catch(error => setStatus(error instanceof Error ? error.message : String(error), 'error'));
});

document.getElementById('reset-url').addEventListener('click', () => {
  appUrlInput.value = DEFAULT_APP_URL;
  void apiCall(extensionApi.storage.sync, 'set', {
    [APP_URL_STORAGE_KEY]: DEFAULT_APP_URL,
  }).then(() => setStatus('Đã khôi phục URL production.'));
});

void loadSettings().catch(error => setStatus(
  error instanceof Error ? error.message : String(error),
  'error',
));
