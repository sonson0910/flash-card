import { listenForReminderOpen } from '../features/reminders/reminderOpenRelay';
import { observeWebVitals } from '../lib/performanceVitals';

/**
 * Work the shell starts without waiting for it, kept out of the initial bundle: the listener for a reminder
 * click that the push worker hands to an already open page, and the buffered startup measurements.
 */
export const startDeferredShellWork = (): void => {
  listenForReminderOpen();
  observeWebVitals();
};
