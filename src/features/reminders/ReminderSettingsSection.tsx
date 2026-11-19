import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { ChevronDown, Mail, Monitor, Puzzle } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Lumi } from '../../components/lumi/Lumi';
import { useUiLocale } from '../../i18n/I18nProvider';
import { currentOwnerId, observeOwner, protectedFunctionsAvailable } from '../session/ownerSessionPort';
import {
  canOfferBrowserPush, defaultReminderSettings, loadReminderDueCount, loadReminderSettings,
  saveReminderSettings, type ReminderSettings,
} from './reminderService';
import '../settings/settings-theme.css';
import './reminder-settings.css';

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const weekdaysVi = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const weekdayLetters = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
/** The week reads Monday first, as on the board; stored day numbers stay 0 = Sunday. */
const mondayFirst = [1, 2, 3, 4, 5, 6, 0];

export const emailDigestDeliveryAvailable = () => import.meta.env.VITE_REMINDER_EMAIL_ENABLED === 'true';

export const reminderSettingsForSave = (settings: ReminderSettings): ReminderSettings => emailDigestDeliveryAvailable()
  ? settings
  : { ...settings, channels: { ...settings.channels, emailDigest: false } };

const pad = (value: number) => String(value).padStart(2, '0');
/** Whole-day choices in fixed steps, plus the saved value when it sits between two steps. */
export const timeChoices = (stepMinutes: number, current: string): string[] => {
  const choices: string[] = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += stepMinutes) choices.push(`${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`);
  if (/^\d{2}:\d{2}$/.test(current) && !choices.includes(current)) choices.push(current);
  return choices.sort();
};
const deviceTimeZone = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; }
};

export interface ReminderSettingsSectionProps {
  readonly initialOwnerId?: string | null;
  readonly embedded?: boolean;
  readonly onSaveStateChange?: (state: { readonly saving: boolean; readonly failed: boolean }) => void;
  readonly onSkip?: () => void;
  /** The page title, rendered above the form when the section is a full settings page. */
  readonly heading?: ReactNode;
  /** Extra settings shown under the reminder form, such as sounds and haptics. */
  readonly footer?: ReactNode;
}

function TimeSelect({ value, label, onChange, step, large = false }: { readonly value: string; readonly label: string; readonly onChange: (value: string) => void; readonly step: number; readonly large?: boolean }) {
  const [hours = '--', minutes = '--'] = value.split(':');
  return <span className={large ? 'rm-time crystal-chamfer-sm' : 'rm-inline-time'}>
    <select aria-label={label} value={value} onChange={event => onChange(event.target.value)}>
      {timeChoices(step, value).map(choice => <option key={choice} value={choice}>{choice}</option>)}
    </select>
    <span className="rm-time__face" aria-hidden="true">{hours}<span className="rm-time__colon">:</span>{minutes}{large && <ChevronDown size={16} className="rm-time__chevron" />}</span>
  </span>;
}

export function ReminderSettingsSection({ initialOwnerId, embedded = false, onSaveStateChange, onSkip, heading, footer }: ReminderSettingsSectionProps) {
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
  const [dueCount, setDueCount] = useState<number | null>(null);

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
      setDueCount(null);
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
      // The preview carries the number a reminder would send today; it stays generic when the count is unknown.
      if (!embedded) void loadReminderDueCount(nextOwnerId).then(count => {
        if (current === generation && currentOwnerId() === nextOwnerId) setDueCount(count);
      }, () => undefined);
    };
    applyOwner(initialOwnerId === currentOwnerId() ? initialOwnerId : currentOwnerId());
    const stop = observeOwner(applyOwner);
    if (!stop) { setStatus('error'); return; }
    void canOfferBrowserPush().then(setPushAvailable, () => setPushAvailable(false));
    return () => { generation++; stop(); };
  }, [embedded, initialOwnerId, loadAttempt]);

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
  const deviceZone = deviceTimeZone();
  const quiet = settings.quietHours;
  const regionLabel = _(msg({ id: 'settings.reminders.title', message: 'Study reminders' }));

  const form = <>
    <div className="ss-panel rm-card crystal-chamfer">
      <div className="rm-schedule">
        <div className="rm-schedule__time">
          <span className="ss-label rm-schedule__label" aria-hidden="true"><Trans {...msg({ context: 'settings.reminders.daily', message: 'Daily reminder' })} /></span>
          <TimeSelect large step={15} label={_(msg({ id: 'settings.reminders.time.label', message: 'Send at' }))} value={settings.sendAtLocal} onChange={sendAtLocal => update({ sendAtLocal })} />
        </div>
        <div className="rm-zone crystal-chamfer-sm">
          <label className="rm-zone__field">
            <span className="rm-zone__label"><Trans {...msg({ context: 'settings.reminders.timezone', message: 'Time zone' })} /></span>
            <input className="rm-zone__input" value={settings.timezone} spellCheck={false} onChange={event => update({ timezone: event.target.value })} />
          </label>
          {deviceZone && deviceZone !== settings.timezone
            ? <button type="button" className="rm-zone__use" onClick={() => update({ timezone: deviceZone })}><Trans {...msg({ context: 'settings.reminders.timezone.use-device', message: 'Use this device’s time zone' })} /></button>
            : <span className="rm-zone__note"><Trans {...msg({ context: 'settings.reminders.timezone.note', message: 'Reminders follow this clock.' })} /></span>}
        </div>
      </div>
      <fieldset className="rm-days">
        <legend className="sr-only"><Trans {...msg({ context: 'settings.reminders.days', message: 'Review days' })} /></legend>
        <div className="rm-days__list">
          {mondayFirst.map(index => <label key={index} className="rm-day">
            <input type="checkbox" aria-label={uiLocale === 'vi' ? weekdaysVi[index] : weekdays[index]} checked={settings.days.includes(index)} onChange={event => update({ days: event.target.checked ? [...settings.days, index].sort() : settings.days.filter(value => value !== index) })} />
            <span className="rm-day__face" aria-hidden="true"><span>{uiLocale === 'vi' ? weekdaysVi[index] : weekdayLetters[index]}</span></span>
          </label>)}
        </div>
        <span className="rm-days__count"><Trans {...msg({ context: 'settings.reminders.days.count', message: '{count, plural, one {# day a week} other {# days a week}}' })} values={{ count: settings.days.length }} /></span>
      </fieldset>
      <label className="ss-row ss-switch-row">
        <span className="ss-row__text"><span className="ss-row__title"><Trans {...msg({ context: 'settings.reminders.smart', message: 'Smart reminder' })} /></span><span className="ss-row__sub"><Trans {...msg({ context: 'settings.reminders.only-if-not-studied.description', message: 'Remind me only if I haven’t studied yet today' })} /></span></span>
        <input type="checkbox" role="switch" checked={settings.onlyIfNotStudiedToday} onChange={event => update({ onlyIfNotStudiedToday: event.target.checked })} />
      </label>
      <div className="ss-row">
        <span className="ss-row__text">
          <span className="ss-row__title rm-quiet__title"><Trans {...msg({ context: 'settings.reminders.quiet', message: 'Quiet hours' })} />{quiet && <> <TimeSelect step={30} label={_(msg({ id: 'settings.reminders.quiet-start.label', message: 'From' }))} value={quiet.startLocal} onChange={startLocal => update({ quietHours: { ...quiet, startLocal } })} /><span aria-hidden="true">–</span><TimeSelect step={30} label={_(msg({ id: 'settings.reminders.quiet-end.label', message: 'Until' }))} value={quiet.endLocal} onChange={endLocal => update({ quietHours: { ...quiet, endLocal } })} /></>}</span>
          <span className="ss-row__sub"><Trans {...msg({ context: 'settings.reminders.quiet.description', message: 'Nothing is sent at night, even if cards are due' })} /></span>
        </span>
        <input type="checkbox" role="switch" aria-label={_(msg({ id: 'settings.reminders.quiet.label', message: 'Quiet hours' }))} checked={quiet !== null} onChange={event => update({ quietHours: event.target.checked ? { startLocal: '22:00', endLocal: '07:00' } : null })} />
      </div>
    </div>

    <h2 className="ss-eyebrow"><Trans {...msg({ context: 'settings.reminders.channels', message: 'Channels' })} /></h2>
    <div className="rm-channels">
      <label className="rm-channel crystal-chamfer-sm">
        <span className="rm-channel__top"><span className="rm-channel__icon"><Monitor size={15} aria-hidden="true" /></span><input type="checkbox" role="switch" checked={settings.channels.push} disabled={(!pushAvailable || pushPermissionDenied) && !settings.channels.push} onChange={event => update({ channels: { ...settings.channels, push: event.target.checked } })} /></span>
        <span className="rm-channel__title"><Trans {...msg({ context: 'settings.reminders.push', message: 'Browser push' })} /></span>
        <span className="rm-channel__sub"><Trans {...msg({ context: 'settings.reminders.push.description', message: 'One notification with the due count' })} /></span>
        {pushPermissionDenied
          ? <span className="rm-channel__hint"><Trans {...msg({ context: 'settings.reminders.push-denied', message: 'Browser notifications are blocked. Allow them in your browser settings to turn on push.' })} /></span>
          : !pushAvailable && !settings.channels.push && <span className="rm-channel__hint"><Trans {...msg({ context: 'settings.reminders.push-unavailable', message: 'Push needs a supported browser and configured web push key.' })} /></span>}
      </label>
      <label className="rm-channel crystal-chamfer-sm">
        <span className="rm-channel__top"><span className="rm-channel__icon"><Mail size={15} aria-hidden="true" /></span><input type="checkbox" role="switch" checked={settings.channels.emailDigest} disabled={!emailAvailable && !settings.channels.emailDigest} onChange={event => update({ channels: { ...settings.channels, emailDigest: event.target.checked } })} /></span>
        <span className="rm-channel__title"><Trans {...msg({ context: 'settings.reminders.email.title', message: 'Weekly digest' })} /></span>
        <span className="rm-channel__sub"><Trans {...msg({ context: 'settings.reminders.email.description', message: 'Sunday email with your recap' })} /></span>
        {!emailAvailable && <span className="rm-channel__hint"><Trans {...msg({ context: 'settings.reminders.email-unavailable', message: 'Weekly email delivery is not available yet. You can turn off an existing recap, but new recaps cannot be enabled.' })} /></span>}
      </label>
      <div className="rm-channel crystal-chamfer-sm" data-reminder-badge>
        <span className="rm-channel__top"><span className="rm-channel__icon"><Puzzle size={15} aria-hidden="true" /></span><span className="rm-channel__readonly"><Trans {...msg({ context: 'settings.reminders.badge.read-only', message: 'Read only' })} /></span></span>
        <span className="rm-channel__title"><Trans {...msg({ context: 'settings.reminders.badge.title', message: 'Extension badge' })} /></span>
        <span className="rm-channel__sub"><Trans {...msg({ context: 'settings.reminders.badge.description', message: 'Due count on the SonFlash icon' })} /></span>
      </div>
    </div>

    {error && <p role="alert" className="ss-alert">{error}</p>}
    <div className="rm-actions">
      <button type="button" className="ss-primary" disabled={saving || settings.days.length === 0 || !protectedFunctionsAvailable()} onClick={() => void save()}><span className="ss-primary__label"><Trans {...msg({ context: 'settings.reminders.save', message: 'Save reminders' })} /></span></button>
      {saveFailed && onSkip && <button type="button" className="ss-secondary" onClick={() => { setSaveFailed(false); setError(null); onSkip(); }}><Trans {...msg({ context: 'settings.reminders.skip', message: 'Skip for now' })} /></button>}
      {saved && <p role="status" className="ss-status"><Trans {...msg({ context: 'settings.reminders.saved', message: 'Reminder settings saved.' })} /></p>}
    </div>
  </>;

  const stateMessage = !ownerId
    ? <p className="ss-panel rm-message crystal-chamfer"><Trans {...msg({ context: 'settings.reminders.sign-in', message: 'Sign in to set reminders.' })} /></p>
    : status === 'loading'
      ? <p className="ss-panel rm-message crystal-chamfer"><Trans {...msg({ context: 'settings.reminders.loading', message: 'Loading reminders…' })} /></p>
      : status === 'error'
        ? <div role="alert" className="ss-panel rm-message crystal-chamfer"><p><Trans {...msg({ context: 'settings.reminders.unavailable', message: 'Reminders are unavailable right now. Try again later.' })} /></p><button type="button" className="ss-secondary" onClick={() => setLoadAttempt(attempt => attempt + 1)}><Trans {...msg({ context: 'common.retry', message: 'Retry' })} /></button></div>
        : null;

  if (embedded) return <section aria-label={regionLabel} className="sf-settings-scope rm-embedded">
    {stateMessage ?? form}
  </section>;

  const host = typeof window === 'undefined' ? '' : window.location?.host ?? '';
  const badge = dueCount === null || dueCount <= 0 ? null : dueCount > 99 ? '99+' : String(dueCount);
  return <section aria-label={regionLabel} className="ss-split rm-layout">
    <div className="ss-split__main">
      {heading}
      {stateMessage ?? form}
      {footer}
    </div>
    <aside aria-label={_(msg({ id: 'settings.reminders.preview.label', message: 'Live preview' }))} className="ss-split__aside rm-preview">
      <h2 className="ss-eyebrow rm-preview__title"><Trans {...msg({ context: 'settings.reminders.preview.title', message: 'Live preview' })} /></h2>
      <div className="rm-os crystal-chamfer-sm">
        <div className="rm-os__head"><span className="rm-os__app"><span className="rm-mark" aria-hidden="true">S</span>SonFlash{host && <> · {host}</>}</span><span>{settings.sendAtLocal}</span></div>
        <p className="rm-os__title">SonFlash</p>
        <p className="rm-os__body">{dueCount === null
          ? <Trans {...msg({ context: 'settings.reminders.preview.body-unknown', message: 'Your due cards are ready for review.' })} />
          : dueCount === 0
            ? <Trans {...msg({ context: 'settings.reminders.preview.body-none', message: 'Nothing is due right now, so no reminder is sent.' })} />
            : <Trans {...msg({ context: 'settings.reminders.preview.body', message: '{count, plural, one {# card is ready for review.} other {# cards are ready for review.}}' })} values={{ count: dueCount }} />}</p>
      </div>
      <div className="rm-mail crystal-chamfer-sm">
        <div className="rm-mail__head"><span><strong>SonFlash</strong> · <Trans {...msg({ context: 'settings.reminders.preview.mail-subject', message: 'Your SonFlash weekly recap' })} /></span><span><Trans {...msg({ context: 'settings.reminders.preview.mail-day', message: 'Sun' })} /></span></div>
        <div className="rm-mail__hero">
          <span className="rm-mail__eyebrow"><Trans {...msg({ context: 'settings.reminders.preview.mail-eyebrow', message: 'Weekly recap' })} /></span>
          <p className="rm-mail__big">{dueCount !== null && <span className="rm-mail__num">{dueCount}</span>} <em>{dueCount === null
            ? <Trans {...msg({ context: 'settings.reminders.preview.mail-unknown', message: 'cards ready for review' })} />
            : <Trans {...msg({ context: 'settings.reminders.preview.mail-count', message: '{count, plural, one {card ready for review} other {cards ready for review}}' })} values={{ count: dueCount }} />}</em></p>
        </div>
        <div className="rm-mail__foot"><span className="rm-mail__link"><Trans {...msg({ context: 'settings.reminders.preview.mail-link', message: 'Continue on SonFlash →' })} /></span></div>
      </div>
      <div className="rm-toolbar crystal-chamfer-sm">
        <div className="rm-toolbar__bar"><span className="rm-toolbar__url" /><span className="rm-toolbar__ext" /><span className="rm-toolbar__icon"><span className="rm-mark" aria-hidden="true">S</span>{badge && <span className="rm-toolbar__badge">{badge}</span>}</span></div>
        <p className="rm-toolbar__caption"><Trans {...msg({ context: 'settings.reminders.preview.badge', message: 'Extension badge shows cards due, right in your toolbar.' })} /></p>
      </div>
      <div className="ss-lumi rm-lumi">
        <Lumi pose="hint" size={116} />
        <div className="ss-lumi__bubble crystal-chamfer-sm"><p className="ss-lumi__tag"><Trans {...msg({ context: 'settings.reminders.lumi.tag', message: 'Lumi · Link' })} /></p><p className="ss-lumi__text"><Trans {...msg({ context: 'settings.reminders.lumi.text', message: 'I only call you once a day, when cards are due.' })} /></p></div>
      </div>
    </aside>
  </section>;
}
