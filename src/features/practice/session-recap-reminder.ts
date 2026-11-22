import type { ReminderSettings } from '../reminders/reminderService';
import { currentOwnerId, protectedFunctionsAvailable } from '../session/ownerSessionPort';

/** The learner's daily reminder as the recap shows it: the push channel of the saved reminder settings. */
export interface SessionRecapReminder {
  readonly enabled: boolean;
  readonly sendAtLocal: string;
  /** Whether this device can turn browser reminders on; turning them off always works. */
  readonly canEnable: boolean;
  /** The saved settings the switch changes; every other field is sent back unchanged. */
  readonly settings: ReminderSettings;
}

export interface SessionRecapReminderPort {
  /** Reads the saved reminder settings; null when no signed-in learner can change them here. */
  load(): Promise<SessionRecapReminder | null>;
  /**
   * Saves the reminder with the push channel switched. Call it straight from the click: the browser
   * asks for notification permission inside it, which needs the click's user activation.
   */
  setEnabled(current: SessionRecapReminder, enabled: boolean, locale: 'en' | 'vi'): Promise<SessionRecapReminder>;
}

type ReminderModule = typeof import('../reminders/reminderService');

let reminderModule: ReminderModule | null = null;

const notificationsDenied = () => typeof Notification !== 'undefined' && Notification.permission === 'denied';

/** Settings drops the email digest the same way while email delivery is off. */
const withoutUnavailableEmail = (settings: ReminderSettings): ReminderSettings => import.meta.env.VITE_REMINDER_EMAIL_ENABLED === 'true'
  ? settings
  : { ...settings, channels: { ...settings.channels, emailDigest: false } };

const snapshot = (settings: ReminderSettings, canEnable: boolean): SessionRecapReminder => ({
  enabled: settings.channels.push, sendAtLocal: settings.sendAtLocal, canEnable, settings,
});

/**
 * The reminder setting the Settings page already edits: one read of the learner's reminder document
 * when the recap opens, and the same save callable as Settings when the learner flips the switch.
 */
export const sessionRecapReminderPort: SessionRecapReminderPort = {
  async load() {
    const ownerId = currentOwnerId();
    if (!ownerId || !protectedFunctionsAvailable()) return null;
    const reminders = await import('../reminders/reminderService');
    reminderModule = reminders;
    const [settings, pushAvailable] = await Promise.all([
      reminders.loadReminderSettings(ownerId),
      reminders.canOfferBrowserPush().catch(() => false),
    ]);
    if (currentOwnerId() !== ownerId) return null;
    return snapshot(settings, pushAvailable && !notificationsDenied());
  },
  setEnabled(current, enabled, locale) {
    if (!reminderModule) return Promise.reject(new Error('Reminder settings are not loaded.'));
    const next = withoutUnavailableEmail({ ...current.settings, locale, channels: { ...current.settings.channels, push: enabled } });
    return reminderModule.saveReminderSettings(next).then(saved => snapshot(saved, current.canEnable && !notificationsDenied()));
  },
};
