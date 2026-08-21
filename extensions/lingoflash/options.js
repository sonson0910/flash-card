'use strict';

const {
  DEFAULT_SETTINGS,
  readSettings,
  writeSettings,
} = globalThis.LingoFlashExtension;

const form = document.getElementById('settings-form');
const autoSpeak = document.getElementById('auto-speak');
const bubbleDuration = document.getElementById('bubble-duration');
const recentLookupsEnabled = document.getElementById('recent-lookups-enabled');
const quickTranslateSource = document.getElementById('quick-translate-source');
const quickTranslateTarget = document.getElementById('quick-translate-target');
const status = document.getElementById('settings-status');

const setStatus = (message = '', tone = '') => {
  status.textContent = message;
  if (tone) status.dataset.tone = tone;
  else delete status.dataset.tone;
};

const applySettings = settings => {
  autoSpeak.checked = settings.autoSpeak;
  bubbleDuration.value = String(settings.bubbleDurationMs);
  recentLookupsEnabled.checked = settings.recentLookupsEnabled;
  quickTranslateSource.value = settings.quickTranslateSource;
  quickTranslateTarget.value = settings.quickTranslateTarget;
};

const load = async () => {
  try {
    applySettings(await readSettings());
  } catch {
    applySettings(DEFAULT_SETTINGS);
    setStatus('Không thể đọc cài đặt hiện tại; đã dùng giá trị mặc định.', 'error');
  }
};

form.addEventListener('submit', event => {
  event.preventDefault();
  void writeSettings({
    autoSpeak: autoSpeak.checked,
    bubbleDurationMs: Number(bubbleDuration.value),
    recentLookupsEnabled: recentLookupsEnabled.checked,
    quickTranslateSource: quickTranslateSource.value,
    quickTranslateTarget: quickTranslateTarget.value,
  }).then(settings => {
    applySettings(settings);
    setStatus('Đã lưu cài đặt.', 'success');
  }).catch(error => setStatus(error instanceof Error ? error.message : 'Không thể lưu cài đặt.', 'error'));
});

void load();
