import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReminderSettings } from '../reminders/reminderService';

const owner = vi.hoisted(() => ({ id: null as string | null, functions: true }));
const reminders = vi.hoisted(() => ({
  loadReminderSettings: vi.fn(),
  saveReminderSettings: vi.fn(),
  canOfferBrowserPush: vi.fn(),
}));
vi.mock('../session/ownerSessionPort', () => ({
  currentOwnerId: () => owner.id,
  protectedFunctionsAvailable: () => owner.functions,
}));
vi.mock('../reminders/reminderService', () => reminders);

const { sessionRecapReminderPort } = await import('./session-recap-reminder');

const saved: ReminderSettings = {
  days: [1, 2, 3, 4, 5], sendAtLocal: '07:30', timezone: 'Asia/Saigon', locale: 'vi',
  quietHours: { startLocal: '22:00', endLocal: '06:00' }, onlyIfNotStudiedToday: true,
  channels: { push: true, emailDigest: true },
};

beforeEach(() => {
  owner.id = 'learner-1';
  owner.functions = true;
  reminders.loadReminderSettings.mockReset().mockResolvedValue(saved);
  reminders.saveReminderSettings.mockReset().mockImplementation(async (settings: ReminderSettings) => settings);
  reminders.canOfferBrowserPush.mockReset().mockResolvedValue(true);
});

describe('sessionRecapReminderPort', () => {
  it('reads nothing when no signed-in learner can change reminders here', async () => {
    owner.id = null;
    await expect(sessionRecapReminderPort.load()).resolves.toBeNull();
    owner.id = 'learner-1';
    owner.functions = false;
    await expect(sessionRecapReminderPort.load()).resolves.toBeNull();
    expect(reminders.loadReminderSettings).not.toHaveBeenCalled();
  });

  it('shows the saved push reminder and its time from one read of the learner settings', async () => {
    const reminder = await sessionRecapReminderPort.load();
    expect(reminders.loadReminderSettings).toHaveBeenCalledTimes(1);
    expect(reminders.loadReminderSettings).toHaveBeenCalledWith('learner-1');
    expect(reminder).toMatchObject({ enabled: true, sendAtLocal: '07:30', canEnable: true });
  });

  it('drops the result when the learner changed while the read was running', async () => {
    reminders.loadReminderSettings.mockImplementation(async () => { owner.id = 'learner-2'; return saved; });
    await expect(sessionRecapReminderPort.load()).resolves.toBeNull();
  });

  it('saves only the push channel and the interface language, keeping every other saved field', async () => {
    const reminder = await sessionRecapReminderPort.load();
    const next = await sessionRecapReminderPort.setEnabled(reminder!, false, 'en');

    expect(reminders.saveReminderSettings).toHaveBeenCalledTimes(1);
    const sent = reminders.saveReminderSettings.mock.calls[0][0] as ReminderSettings;
    expect(sent).toMatchObject({ days: saved.days, sendAtLocal: '07:30', timezone: 'Asia/Saigon', quietHours: saved.quietHours, onlyIfNotStudiedToday: true, locale: 'en' });
    expect(sent.channels.push).toBe(false);
    // Settings sends the email digest only while email delivery is on.
    expect(sent.channels.emailDigest).toBe(import.meta.env.VITE_REMINDER_EMAIL_ENABLED === 'true');
    expect(next.enabled).toBe(false);
  });

  it('reports the reminder as off when the browser kept push from turning on', async () => {
    const reminder = await sessionRecapReminderPort.load();
    reminders.saveReminderSettings.mockImplementation(async (settings: ReminderSettings) => ({ ...settings, channels: { ...settings.channels, push: false } }));
    const next = await sessionRecapReminderPort.setEnabled({ ...reminder!, enabled: false }, true, 'vi');
    expect((reminders.saveReminderSettings.mock.calls[0][0] as ReminderSettings).channels.push).toBe(true);
    expect(next.enabled).toBe(false);
  });
});
