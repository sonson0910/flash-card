import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { Bell } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useUiLocale } from '../../i18n/I18nProvider';
import { currentOwnerId, observeOwner, protectedFunctionsAvailable } from '../session/ownerSessionPort';
import {
  canOfferBrowserPush, defaultReminderSettings, loadReminderSettings,
  saveReminderSettings, type ReminderSettings,
} from './reminderService';

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const weekdaysVi = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

export const emailDigestDeliveryAvailable = () => import.meta.env.VITE_REMINDER_EMAIL_ENABLED === 'true';

export const reminderSettingsForSave = (settings: ReminderSettings): ReminderSettings => emailDigestDeliveryAvailable()
  ? settings
  : { ...settings, channels: { ...settings.channels, emailDigest: false } };

export interface ReminderSettingsSectionProps {
  readonly initialOwnerId?: string | null;
  readonly embedded?: boolean;
  readonly onSaveStateChange?: (state: { readonly saving: boolean; readonly failed: boolean }) => void;
  readonly onSkip?: () => void;
}

export function ReminderSettingsSection({ initialOwnerId, embedded = false, onSaveStateChange, onSkip }: ReminderSettingsSectionProps) {
  const { _ } = useLingui();
  const uiLocale = useUiLocale();
  const [ownerId, setOwnerId] = useState<string | null>(() => initialOwnerId ?? currentOwnerId());
  const [settings, setSettings] = useState<ReminderSettings>(defaultReminderSettings);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [pushAvailable, setPushAvailable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    let generation = 0;
    let appliedOwnerId: string | null | undefined;
    const applyOwner = (nextOwnerId: string | null) => {
      if (nextOwnerId === appliedOwnerId) return;
      appliedOwnerId = nextOwnerId;
      const current = ++generation;
      setOwnerId(nextOwnerId);
      setSaving(false);
      setError(null);
      setSaved(false);
      setSaveFailed(false);
      if (!nextOwnerId) { setStatus('ready'); setSettings(defaultReminderSettings()); return; }
      setStatus('loading');
      void loadReminderSettings(nextOwnerId).then(value => {
        if (current !== generation || currentOwnerId() !== nextOwnerId) return;
        setSettings(value);
        setStatus('ready');
      }, () => {
        if (current !== generation || currentOwnerId() !== nextOwnerId) return;
        setStatus('error');
      });
    };
    applyOwner(initialOwnerId === currentOwnerId() ? initialOwnerId : currentOwnerId());
    const stop = observeOwner(applyOwner);
    if (!stop) { setStatus('error'); return; }
    void canOfferBrowserPush().then(setPushAvailable, () => setPushAvailable(false));
    return () => { generation++; stop(); };
  }, [initialOwnerId, loadAttempt]);

  useEffect(() => {
    onSaveStateChange?.({ saving, failed: saveFailed });
  }, [onSaveStateChange, saveFailed, saving]);

  const update = (patch: Partial<ReminderSettings>) => {
    setSettings(previous => ({ ...previous, ...patch }));
    setSaved(false);
    setError(null);
  };
  const save = async () => {
    const savingOwnerId = ownerId;
    const settingsToSave = reminderSettingsForSave({ ...settings, locale: uiLocale === 'vi' ? 'vi' : 'en' });
    let failed = false;
    onSaveStateChange?.({ saving: true, failed: false });
    setSaving(true);
    setSaved(false);
    setError(null);
    setSaveFailed(false);
    try {
      const savedSettings = await saveReminderSettings(settingsToSave);
      if (currentOwnerId() === savingOwnerId) {
        setSettings(savedSettings);
        setSaved(true);
      }
    } catch (failure) {
      failed = true;
      if (currentOwnerId() === savingOwnerId) {
        setSaveFailed(true);
        setError(failure instanceof Error ? failure.message : 'Reminder settings could not be saved.');
        onSaveStateChange?.({ saving: false, failed: true });
      }
    } finally {
      if (currentOwnerId() === savingOwnerId) {
        setSaving(false);
        if (!failed) onSaveStateChange?.({ saving: false, failed: false });
      }
    }
  };
  const pushPermissionDenied = typeof Notification !== 'undefined' && Notification.permission === 'denied';
  const emailAvailable = emailDigestDeliveryAvailable();

  return <section aria-labelledby={embedded ? undefined : 'settings-reminders'} aria-label={embedded ? _(msg({ id: 'settings.reminders.title', message: 'Study reminders' })) : undefined} className="settings-panel rounded-[28px] border border-[var(--sf-border)] bg-[var(--sf-surface-glass)] p-4 shadow-[0_22px_56px_-38px_var(--sf-shadow)] sm:p-6">
    {!embedded && <div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-xl bg-[var(--sf-surface-control)] text-[var(--sf-brand-text)]"><Bell size={20} aria-hidden="true" /></span><div><h2 id="settings-reminders" className="text-xl font-black text-[var(--sf-text)]"><Trans id="settings.reminders.title" message="Study reminders" /></h2><p className="mt-1 text-sm text-[var(--sf-text-muted)]"><Trans id="settings.reminders.description" message="Choose when SonFlash can remind you to review." /></p></div></div>}
    {!ownerId && <p className="mt-5 text-sm text-[var(--sf-text-muted)]"><Trans id="settings.reminders.sign-in" message="Sign in to set reminders." /></p>}
    {ownerId && status === 'loading' && <p className="mt-5 text-sm text-[var(--sf-text-muted)]"><Trans id="settings.reminders.loading" message="Loading reminders…" /></p>}
    {ownerId && status === 'error' && <div role="alert" className="mt-5 text-sm text-[var(--sf-text-muted)]"><p><Trans id="settings.reminders.unavailable" message="Reminders are unavailable right now. Try again later." /></p><button type="button" onClick={() => setLoadAttempt(attempt => attempt + 1)} className="mt-3 min-h-11 rounded-xl border border-[var(--sf-border)] px-4 font-bold text-[var(--sf-text)]"><Trans id="common.retry" message="Retry" /></button></div>}
    {ownerId && status === 'ready' && <div className="mt-5 grid gap-4">
      <fieldset><legend className="text-sm font-bold"><Trans id="settings.reminders.days" message="Review days" /></legend><div className="mt-2 flex flex-wrap gap-2">{weekdays.map((day, index) => <label key={day} className="flex min-h-11 items-center gap-2 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface)] px-3 text-sm"><input type="checkbox" checked={settings.days.includes(index)} onChange={event => update({ days: event.target.checked ? [...settings.days, index].sort() : settings.days.filter(value => value !== index) })} />{uiLocale === 'vi' ? weekdaysVi[index] : day}</label>)}</div></fieldset>
      <div className="flex flex-wrap gap-3"><label className="grid gap-1 text-sm font-bold"><Trans id="settings.reminders.time" message="Send at" /><input type="time" value={settings.sendAtLocal} onChange={event => update({ sendAtLocal: event.target.value })} className="min-h-11 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface)] px-3" /></label><label className="grid gap-1 text-sm font-bold"><Trans id="settings.reminders.timezone" message="Time zone" /><input value={settings.timezone} onChange={event => update({ timezone: event.target.value })} className="min-h-11 min-w-56 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface)] px-3" /></label></div>
      <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={settings.quietHours !== null} onChange={event => update({ quietHours: event.target.checked ? { startLocal: '22:00', endLocal: '07:00' } : null })} /><Trans id="settings.reminders.quiet" message="Quiet hours" /></label>
      {settings.quietHours && <div className="flex gap-3"><label className="grid gap-1 text-sm"><Trans id="settings.reminders.quiet-start" message="From" /><input type="time" value={settings.quietHours.startLocal} onChange={event => update({ quietHours: { ...settings.quietHours!, startLocal: event.target.value } })} className="min-h-11 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface)] px-3" /></label><label className="grid gap-1 text-sm"><Trans id="settings.reminders.quiet-end" message="Until" /><input type="time" value={settings.quietHours.endLocal} onChange={event => update({ quietHours: { ...settings.quietHours!, endLocal: event.target.value } })} className="min-h-11 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface)] px-3" /></label></div>}
      <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={settings.onlyIfNotStudiedToday} onChange={event => update({ onlyIfNotStudiedToday: event.target.checked })} /><Trans id="settings.reminders.only-if-not-studied" message="Skip reminders after I study that day" /></label>
      <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" role="switch" checked={settings.channels.push} disabled={(!pushAvailable || pushPermissionDenied) && !settings.channels.push} onChange={event => update({ channels: { ...settings.channels, push: event.target.checked } })} /><span><Trans id="settings.reminders.push" message="Browser push" />{pushPermissionDenied ? <span className="block text-xs text-[var(--sf-text-muted)]"><Trans id="settings.reminders.push-denied" message="Browser notifications are blocked. Allow them in your browser settings to turn on push." /></span> : !pushAvailable && !settings.channels.push && <span className="block text-xs text-[var(--sf-text-muted)]"><Trans id="settings.reminders.push-unavailable" message="Push needs a supported browser and configured web push key." /></span>}</span></label>
      <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" role="switch" checked={settings.channels.emailDigest} disabled={!emailAvailable && !settings.channels.emailDigest} onChange={event => update({ channels: { ...settings.channels, emailDigest: event.target.checked } })} /><span><Trans id="settings.reminders.email" message="Sunday email recap" />{!emailAvailable && <span className="block text-xs text-[var(--sf-text-muted)]"><Trans id="settings.reminders.email-unavailable" message="Weekly email delivery is not available yet. You can turn off an existing recap, but new recaps cannot be enabled." /></span>}</span></label>
      <p className="text-xs text-[var(--sf-text-muted)]"><Trans id="settings.reminders.badge" message="The browser extension badge shows due cards separately; it is read only." /></p>
      {error && <p role="alert" className="text-sm text-[var(--sf-danger)]">{error}</p>}
      {saved && <p role="status" className="text-sm text-[var(--sf-text-muted)]"><Trans id="settings.reminders.saved" message="Reminder settings saved." /></p>}
      <div className="flex flex-wrap gap-3"><button type="button" disabled={saving || settings.days.length === 0 || !protectedFunctionsAvailable()} onClick={() => void save()} className="min-h-11 w-fit rounded-xl bg-[var(--sf-brand)] px-5 font-bold text-white disabled:opacity-50"><Trans id="settings.reminders.save" message="Save reminders" /></button>
      {saveFailed && onSkip && <button type="button" onClick={() => { setSaveFailed(false); setError(null); onSkip(); }} className="min-h-11 w-fit rounded-xl border border-[var(--sf-border)] px-5 font-bold text-[var(--sf-text)]"><Trans id="settings.reminders.skip" message="Skip for now" /></button>}</div>
    </div>}
  </section>;
}
