'use strict';

const {
  DEFAULT_APP_URL,
  extensionApi,
  apiCall,
} = globalThis.LingoFlashExtension;

const status = document.getElementById('status');
const shortcutValue = document.getElementById('shortcut-value');
document.getElementById('app-url').value = DEFAULT_APP_URL;

const setStatus = (message = '', tone = '') => {
  status.textContent = message;
  if (tone) status.dataset.tone = tone;
  else delete status.dataset.tone;
};

const sendMessage = message => apiCall(extensionApi.runtime, 'sendMessage', message);

void apiCall(extensionApi.commands, 'getAll').then(commands => {
  const command = commands?.find(candidate => candidate.name === 'translate-selection');
  if (command?.shortcut) shortcutValue.textContent = command.shortcut;
}).catch(() => undefined);

document.getElementById('open-app').addEventListener('click', () => {
  void sendMessage({ type: 'OPEN_APP' }).then(response => {
    if (!response?.ok) throw new Error(response?.error || 'Không thể mở LingoFlash.');
    setStatus('Đã mở LingoFlash. Hãy đăng nhập, sau đó có thể đóng tab đó.');
  }).catch(error => setStatus(error instanceof Error ? error.message : String(error), 'error'));
});
