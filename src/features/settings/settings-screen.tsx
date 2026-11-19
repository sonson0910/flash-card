import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { Bell, Check, Database, Languages, Monitor, Moon, Palette, Play, Sun, Vibrate, Volume2, type LucideIcon } from 'lucide-react';
import { lazy, Suspense, useEffect, useLayoutEffect, useState, type ReactNode, type RefObject } from 'react';
import { Lumi } from '../../components/lumi/Lumi';
import { getActiveUiLocale, loadCatalog } from '../../i18n/loadCatalog';
import { triggerHaptic, useHapticsSettings } from '../../lib/haptics';
import { playFlipSound, useSoundSettings } from '../../lib/interactionSounds';
import { useUserReducedMotion } from '../../lib/motionPreference';
import { useTheme } from '../theme/ThemeProvider';
import { useFocusModePreference } from './focus-mode-preference';
import { applyLumiEnabled, readLumiEnabled } from './lumi-preference';
import { DEFAULT_SETTINGS_SECTION, type SettingsSectionId } from './settings-sections';
import './settings-theme.css';
import './settings-screen.css';

// Course/goal/pace preferences pull in course context, icons and forms that
// most settings visits never touch; keeping this section out of the initial
// bundle matters while the initial-JS budget has almost no headroom left.
const CourseSettingsSection = lazy(() => import('./CourseSettingsSection').then(module => ({ default: module.CourseSettingsSection })));
const ReminderSettingsSection = lazy(() => import('../reminders/ReminderSettingsSection').then(module => ({ default: module.ReminderSettingsSection })));
const AccountDataSection = lazy(() => Promise.all([
  import('../account/AccountDataSection'), loadCatalog(getActiveUiLocale(), 'account'),
]).then(([module]) => ({ default: module.AccountDataSection })));

export { SETTINGS_SECTIONS, type SettingsSectionId } from './settings-sections';

export interface SettingsScreenProps {
  readonly headingRef?: RefObject<HTMLHeadingElement | null>;
  readonly focusIntent?: number;
  /**
   * The open section. The app runtime passes the URL's `?section=` and pushes a
   * new one through `onSelectSection`, so back and forward walk the sections.
   * Without it the screen keeps its own section, starting at `initialSection`.
   */
  readonly section?: SettingsSectionId;
  readonly onSelectSection?: (section: SettingsSectionId) => void;
  readonly initialSection?: SettingsSectionId;
}

type ThemeCard = 'midnight' | 'paper' | 'crystal';
type ThemePreviewVariant = 'classic-dark' | 'classic-light' | 'crystal-dark' | 'crystal-light';

function ThemePreview({ variant, selected = false }: { readonly variant: ThemePreviewVariant; readonly selected?: boolean }) {
  return <div data-theme-preview={variant} data-selected={selected ? 'true' : undefined} className="settings-preview" aria-hidden="true">
    <div className="settings-preview__header"><span className="settings-preview__mark" /><span className="settings-preview__wordmark" /><span className="settings-preview__status" /></div>
    <div className="settings-preview__surface"><span className="settings-preview__eyebrow" /><span className="settings-preview__title" /><span className="settings-preview__copy" /><span className="settings-preview__action" /></div>
  </div>;
}

function ThemePreviews({ kind, family, mode }: { readonly kind: ThemeCard; readonly family: 'classic' | 'crystal'; readonly mode: 'dark' | 'light' }) {
  if (kind === 'crystal') return <div className="settings-preview-pair">
    <ThemePreview variant="crystal-dark" selected={family === 'crystal' && mode === 'dark'} />
    <ThemePreview variant="crystal-light" selected={family === 'crystal' && mode === 'light'} />
  </div>;
  return <ThemePreview variant={kind === 'midnight' ? 'classic-dark' : 'classic-light'} selected={family === 'classic' && (kind === 'midnight' ? mode === 'dark' : mode === 'light')} />;
}

function ThemeOption({ checked, kind, family, mode, onChange, children }: { readonly checked: boolean; readonly kind: ThemeCard; readonly family: 'classic' | 'crystal'; readonly mode: 'dark' | 'light'; readonly onChange: () => void; readonly children: ReactNode }) {
  return <label className="ss-theme-option crystal-chamfer-sm min-h-11" data-checked={checked ? 'true' : undefined}>
    <input className="sr-only" type="radio" name="settings-theme" checked={checked} onChange={onChange} />
    <span className="ss-theme-option__head"><span className="ss-theme-option__text">{children}</span>{checked && <Check className="ss-theme-option__check" size={18} aria-hidden="true" />}</span>
    <ThemePreviews kind={kind} family={family} mode={mode} />
  </label>;
}

function SwitchRow({ checked, description, label, onChange, disabled = false, leading }: { readonly checked: boolean; readonly description: ReactNode; readonly label: ReactNode; readonly onChange: (checked: boolean) => void; readonly disabled?: boolean; readonly leading?: ReactNode }) {
  return <label className={`ss-row ss-switch-row${disabled ? ' is-disabled' : ''}`}>
    {leading}
    <span className="ss-row__text"><span className="ss-row__title">{label}</span><span className="ss-row__sub">{description}</span></span>
    <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />
  </label>;
}

/** Study sounds and haptics are single device-wide switches; each tile can play a sample while it is on. */
export function SoundsAndHaptics() {
  const { _ } = useLingui();
  const { isSoundEnabled, setSoundEnabled } = useSoundSettings();
  const { isHapticsEnabled, setHapticsEnabled } = useHapticsSettings();
  const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  return <div className="ss-sound-grid">
    <div className="ss-sound-tile crystal-chamfer-sm">
      <button type="button" className="ss-sound-tile__play" disabled={!isSoundEnabled} onClick={playFlipSound} aria-label={_(msg({ id: 'settings.sound.preview', message: 'Play a sample study sound' }))}><span className="ss-sound-tile__dot"><Play size={12} fill="currentColor" aria-hidden="true" /></span></button>
      <label className="ss-sound-tile__label"><span className="ss-sound-tile__name"><Volume2 size={15} aria-hidden="true" className="ss-sound-tile__icon" /><Trans {...msg({ context: 'settings.sound.label', message: 'Study sounds' })} /></span><input type="checkbox" role="switch" checked={isSoundEnabled} onChange={event => setSoundEnabled(event.target.checked)} /></label>
    </div>
    <div className="ss-sound-tile crystal-chamfer-sm">
      <button type="button" className="ss-sound-tile__play" disabled={!isHapticsEnabled || !canVibrate} onClick={() => triggerHaptic('medium')} aria-label={_(msg({ id: 'settings.haptics.preview', message: 'Try a haptic pulse' }))}><span className="ss-sound-tile__dot"><Play size={12} fill="currentColor" aria-hidden="true" /></span></button>
      <label className="ss-sound-tile__label"><span className="ss-sound-tile__name"><Vibrate size={15} aria-hidden="true" className="ss-sound-tile__icon" /><Trans {...msg({ context: 'settings.haptics.label', message: 'Haptics' })} /></span><input type="checkbox" role="switch" checked={isHapticsEnabled} onChange={event => setHapticsEnabled(event.target.checked)} /></label>
    </div>
  </div>;
}

function PageHeading({ headingRef, children, subtitle }: { readonly headingRef?: RefObject<HTMLHeadingElement | null>; readonly children: ReactNode; readonly subtitle: ReactNode }) {
  return <header className="ss-page-heading">
    <h1 ref={headingRef} tabIndex={-1} className="ss-title">{children}</h1>
    <p className="ss-subtitle">{subtitle}</p>
  </header>;
}

function AppearanceSection({ headingRef }: { readonly headingRef?: RefObject<HTMLHeadingElement | null> }) {
  const { family, mode, followSystem, setFamily, setMode, setFollowSystem } = useTheme();
  const [reducedMotion, setReducedMotion] = useUserReducedMotion();
  const { focusModeEnabled, setFocusModeEnabled } = useFocusModePreference();
  const [lumiEnabled, setLumiEnabled] = useState(readLumiEnabled);

  useEffect(() => {
    applyLumiEnabled(lumiEnabled, null);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== 'sonflash_lumi_enabled') return;
      const enabled = readLumiEnabled();
      setLumiEnabled(enabled);
      applyLumiEnabled(enabled, null);
    };
    globalThis.addEventListener?.('storage', onStorage);
    return () => globalThis.removeEventListener?.('storage', onStorage);
  // Root synchronization must not create a value when no preference was saved.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const setLumi = (enabled: boolean) => { setLumiEnabled(enabled); applyLumiEnabled(enabled); };
  const choose = (next: ThemeCard) => {
    if (next === 'crystal') setFamily('crystal');
    else { setFamily('classic'); setMode(next === 'midnight' ? 'dark' : 'light'); }
  };

  return <section aria-labelledby="settings-appearance" className="ss-single">
    <PageHeading headingRef={headingRef} subtitle={<Trans {...msg({ context: 'settings.description', message: 'Choose a look and tune the details that help you focus.' })} />}>
      <Trans {...msg({ context: 'settings.title', message: 'Make your study space <0>yours</0>' })} components={{ 0: <em /> }} />
    </PageHeading>
    <h2 id="settings-appearance" className="ss-eyebrow"><Trans {...msg({ context: 'settings.appearance.title', message: 'Appearance' })} /></h2>
    <div className="ss-panel crystal-chamfer">
      <fieldset className="settings-theme-picker"><legend className="ss-label"><Trans {...msg({ context: 'settings.theme.label', message: 'Theme' })} /></legend><div className="ss-theme-grid">
        <ThemeOption kind="midnight" family={family} mode={mode} checked={family === 'classic' && mode === 'dark'} onChange={() => choose('midnight')}><span className="ss-theme-option__name"><Trans {...msg({ context: 'settings.theme.midnight', message: 'Midnight Aurora' })} /></span><span className="ss-theme-option__sub"><Trans {...msg({ context: 'settings.theme.midnight.description', message: 'A deep, calm night palette.' })} /></span></ThemeOption>
        <ThemeOption kind="paper" family={family} mode={mode} checked={family === 'classic' && mode === 'light'} onChange={() => choose('paper')}><span className="ss-theme-option__name"><Trans {...msg({ context: 'settings.theme.paper', message: 'Ink & Paper' })} /></span><span className="ss-theme-option__sub"><Trans {...msg({ context: 'settings.theme.paper.description', message: 'A warm, bright reading surface.' })} /></span></ThemeOption>
        <ThemeOption kind="crystal" family={family} mode={mode} checked={family === 'crystal'} onChange={() => choose('crystal')}><span className="ss-theme-option__name"><Trans {...msg({ context: 'settings.theme.crystal', message: 'Crystal Star' })} /></span><span className="ss-theme-option__sub"><Trans {...msg({ context: 'settings.theme.crystal.description', message: 'A sparkling study space with Lumi.' })} /></span></ThemeOption>
      </div></fieldset>
      {family === 'crystal' && <fieldset className="ss-crystal-mode"><legend className="ss-label"><Trans {...msg({ context: 'settings.crystal-mode.label', message: 'Crystal Star mode' })} /></legend><div className="ss-crystal-mode__options">
        <label className="ss-crystal-mode__option crystal-chamfer-sm"><input type="radio" name="settings-crystal-mode" checked={mode === 'dark'} onChange={() => setMode('dark')} /><Moon size={18} aria-hidden="true" /><span><Trans {...msg({ context: 'settings.crystal-mode.night', message: 'Starry Night' })} /></span></label>
        <label className="ss-crystal-mode__option crystal-chamfer-sm"><input type="radio" name="settings-crystal-mode" checked={mode === 'light'} onChange={() => setMode('light')} /><Sun size={18} aria-hidden="true" /><span><Trans {...msg({ context: 'settings.crystal-mode.day', message: 'Prism Day' })} /></span></label>
      </div></fieldset>}
    </div>
    <h2 className="ss-eyebrow"><Trans {...msg({ context: 'settings.display.title', message: 'Display' })} /></h2>
    <div className="ss-panel ss-panel--rows crystal-chamfer">
      <SwitchRow checked={followSystem} leading={<span className="ss-row__icon"><Monitor size={16} aria-hidden="true" /></span>} label={<Trans {...msg({ context: 'settings.follow-system.label', message: 'Follow system' })} />} description={<Trans {...msg({ context: 'settings.follow-system.description', message: 'Match your device’s light or dark setting.' })} />} onChange={setFollowSystem} />
      <SwitchRow checked={reducedMotion} leading={<span className="ss-row__icon"><Palette size={16} aria-hidden="true" /></span>} label={<Trans {...msg({ context: 'settings.reduced-motion.label', message: 'Reduced motion' })} />} description={<Trans {...msg({ context: 'settings.reduced-motion.description', message: 'Limit movement and animated effects.' })} />} onChange={setReducedMotion} />
      <SwitchRow checked={lumiEnabled} disabled={family !== 'crystal'} leading={<span className="ss-row__icon ss-row__icon--lumi" data-settings-lumi><Lumi pose="happy" size={36} /></span>} label={<Trans {...msg({ context: 'settings.lumi.label', message: 'Lumi' })} />} description={<Trans {...msg({ context: 'settings.lumi.description', message: 'Show your Crystal Star study companion.' })} />} onChange={setLumi} />
      <SwitchRow checked={focusModeEnabled} leading={<span className="ss-row__icon"><Check size={16} aria-hidden="true" /></span>} label={<Trans {...msg({ context: 'settings.focus-mode.label', message: 'Focus mode' })} />} description={<Trans {...msg({ context: 'settings.focus-mode.description', message: 'Hide combo banners while studying.' })} />} onChange={setFocusModeEnabled} />
    </div>
    <h2 className="ss-eyebrow"><Trans {...msg({ context: 'settings.sounds.eyebrow', message: 'Sounds & haptics' })} /></h2>
    <SoundsAndHaptics />
  </section>;
}

function SoundsSection({ headingRef }: { readonly headingRef?: RefObject<HTMLHeadingElement | null> }) {
  return <section aria-labelledby="settings-sounds" className="ss-single">
    <PageHeading headingRef={headingRef} subtitle={<Trans {...msg({ context: 'settings.sounds.description', message: 'Feedback while you study, on this device.' })} />}>
      <Trans {...msg({ context: 'settings.sounds.title', message: 'Sounds & <0>haptics</0>' })} components={{ 0: <em /> }} />
    </PageHeading>
    <h2 id="settings-sounds" className="ss-eyebrow"><Trans {...msg({ context: 'settings.sounds.eyebrow', message: 'Sounds & haptics' })} /></h2>
    <SoundsAndHaptics />
  </section>;
}

function DataSection({ headingRef }: { readonly headingRef?: RefObject<HTMLHeadingElement | null> }) {
  const [open, setOpen] = useState(false);
  return <section aria-labelledby="settings-data" className="ss-single">
    <PageHeading headingRef={headingRef} subtitle={<Trans {...msg({ context: 'settings.data.description', message: 'Download what you have saved, or delete your account.' })} />}>
      <Trans {...msg({ context: 'settings.data.title', message: 'Data & <0>export</0>' })} components={{ 0: <em /> }} />
    </PageHeading>
    <h2 id="settings-data" className="ss-eyebrow"><Trans {...msg({ context: 'settings.data.eyebrow', message: 'Your account data' })} /></h2>
    <div className="ss-panel ss-panel--rows crystal-chamfer">
      <div className="ss-row">
        <span className="ss-row__icon"><Database size={16} aria-hidden="true" /></span>
        <span className="ss-row__text"><span className="ss-row__title"><Trans {...msg({ context: 'settings.data.row.title', message: 'Export or delete' })} /></span><span className="ss-row__sub"><Trans {...msg({ context: 'settings.data.row.description', message: 'Download your account data as a file, or permanently delete your account.' })} /></span></span>
        <button type="button" className="ss-secondary crystal-chamfer-sm" onClick={() => setOpen(true)}><Trans {...msg({ context: 'settings.data.open', message: 'Open data & export' })} /></button>
      </div>
    </div>
    {open && <Suspense fallback={null}><AccountDataSection open={open} onOpenChange={setOpen} /></Suspense>}
  </section>;
}

const MENU: ReadonlyArray<{ readonly id: SettingsSectionId; readonly icon: LucideIcon }> = [
  { id: 'appearance', icon: Palette },
  { id: 'language', icon: Languages },
  { id: 'reminders', icon: Bell },
  { id: 'sounds', icon: Volume2 },
  { id: 'data', icon: Database },
];

function MenuLabel({ id }: { readonly id: SettingsSectionId }) {
  if (id === 'appearance') return <Trans {...msg({ context: 'settings.menu.appearance', message: 'Appearance' })} />;
  if (id === 'language') return <Trans {...msg({ context: 'settings.menu.language', message: 'Language & courses' })} />;
  if (id === 'reminders') return <Trans {...msg({ context: 'settings.menu.reminders', message: 'Reminders' })} />;
  if (id === 'sounds') return <Trans {...msg({ context: 'settings.menu.sounds', message: 'Sounds & haptics' })} />;
  return <Trans {...msg({ context: 'settings.menu.data', message: 'Data & export' })} />;
}

export default function SettingsScreen({ headingRef, focusIntent = 0, section: controlledSection, onSelectSection, initialSection }: SettingsScreenProps) {
  const { _ } = useLingui();
  const [localSection, setLocalSection] = useState<SettingsSectionId>(() => initialSection ?? DEFAULT_SETTINGS_SECTION);
  const section = controlledSection ?? localSection;
  const selectSection = (next: SettingsSectionId) => {
    if (next === section) return;
    setLocalSection(next);
    onSelectSection?.(next);
  };

  useLayoutEffect(() => {
    if (focusIntent > 0) headingRef?.current?.focus({ preventScroll: true });
  }, [focusIntent, headingRef]);

  const soundsBlock = <>
    <h2 className="ss-eyebrow"><Trans {...msg({ context: 'settings.sounds.eyebrow', message: 'Sounds & haptics' })} /></h2>
    <SoundsAndHaptics />
  </>;

  return <div className="settings-screen sf-settings-scope" data-settings-section={section}>
    <nav aria-label={_(msg({ id: 'settings.menu.label', message: 'Settings sections' }))} className="ss-menu">
      <p className="ss-menu__title" aria-hidden="true"><Trans {...msg({ context: 'settings.kicker', message: 'Settings' })} /></p>
      <ul className="ss-menu__list">
        {MENU.map(({ id, icon: Icon }) => <li key={id}>
          <button type="button" className="ss-menu__item" aria-current={section === id ? 'page' : undefined} onClick={() => selectSection(id)}>
            <span className="ss-menu__label"><Icon size={17} aria-hidden="true" /><MenuLabel id={id} /></span>
          </button>
        </li>)}
      </ul>
    </nav>
    <div className="ss-content">
      {section === 'appearance' && <AppearanceSection headingRef={headingRef} />}
      {section === 'language' && <Suspense fallback={null}><CourseSettingsSection heading={<PageHeading headingRef={headingRef} subtitle={<Trans {...msg({ context: 'settings.language.description', message: 'The app speaks one language. Each course teaches another.' })} />}><Trans {...msg({ context: 'settings.language.title', message: 'Language & <0>courses</0>' })} components={{ 0: <em /> }} /></PageHeading>} /></Suspense>}
      {section === 'reminders' && <Suspense fallback={null}><ReminderSettingsSection heading={<PageHeading headingRef={headingRef} subtitle={<Trans {...msg({ context: 'settings.reminders.description', message: 'We remind you once a day, only when cards are waiting.' })} />}><Trans {...msg({ context: 'settings.reminders.page-title', message: 'A nudge, <0>not a nag.</0>' })} components={{ 0: <em /> }} /></PageHeading>} footer={soundsBlock} /></Suspense>}
      {section === 'sounds' && <SoundsSection headingRef={headingRef} />}
      {section === 'data' && <DataSection headingRef={headingRef} />}
    </div>
  </div>;
}
