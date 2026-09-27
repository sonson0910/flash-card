import { Trans } from '@lingui/react';
import { Check, Monitor, Moon, Palette, Sparkles, Sun, Vibrate, Volume2 } from 'lucide-react';
import { lazy, Suspense, useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import { Lumi } from '../../components/lumi/Lumi';
import { useHapticsSettings } from '../../lib/haptics';
import { useSoundSettings } from '../../lib/interactionSounds';
import { useUserReducedMotion } from '../../lib/motionPreference';
import { useTheme } from '../theme/ThemeProvider';
import { applyLumiEnabled, readLumiEnabled } from './lumi-preference';
import './settings-screen.css';

// Course/goal/pace preferences pull in course context, icons and forms that
// most settings visits never touch; keeping this section out of the initial
// bundle matters while the initial-JS budget has almost no headroom left.
const CourseSettingsSection = lazy(() => import('./CourseSettingsSection').then(module => ({ default: module.CourseSettingsSection })));

export interface SettingsScreenProps {
  readonly headingRef?: RefObject<HTMLHeadingElement | null>;
  readonly focusIntent?: number;
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
  if (kind === 'crystal') return <div className="settings-preview-pair mt-4 grid grid-cols-2 gap-2">
    <ThemePreview variant="crystal-dark" selected={family === 'crystal' && mode === 'dark'} />
    <ThemePreview variant="crystal-light" selected={family === 'crystal' && mode === 'light'} />
  </div>;
  return <div className="mt-4"><ThemePreview variant={kind === 'midnight' ? 'classic-dark' : 'classic-light'} selected={family === 'classic' && (kind === 'midnight' ? mode === 'dark' : mode === 'light')} /></div>;
}

function ThemeOption({ checked, kind, family, mode, onChange, children }: { readonly checked: boolean; readonly kind: ThemeCard; readonly family: 'classic' | 'crystal'; readonly mode: 'dark' | 'light'; readonly onChange: () => void; readonly children: React.ReactNode }) {
  return <label className={`relative block min-h-11 cursor-pointer rounded-2xl border p-3 transition-colors focus-within:outline-2 focus-within:outline-offset-2 ${checked ? 'border-[var(--sf-brand)] bg-[var(--sf-surface-raised)] shadow-[0_14px_30px_-24px_var(--sf-shadow)]' : 'border-[var(--sf-border)] bg-[var(--sf-surface)] hover:border-[var(--sf-brand)]'}`}>
    <input className="sr-only" type="radio" name="settings-theme" checked={checked} onChange={onChange} />
    <span className="flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--sf-surface-control)] text-[var(--sf-brand-text)]"><Palette size={18} aria-hidden="true" /></span><span className="min-w-0 flex-1">{children}</span>{checked && <Check className="mt-1 shrink-0 text-[var(--sf-brand-text)]" size={18} aria-hidden="true" />}</span>
    <ThemePreviews kind={kind} family={family} mode={mode} />
  </label>;
}

function SwitchRow({ checked, description, label, onChange, disabled = false }: { readonly checked: boolean; readonly description: React.ReactNode; readonly label: React.ReactNode; readonly onChange: (checked: boolean) => void; readonly disabled?: boolean }) {
  return <label className={`flex min-h-14 items-center gap-4 rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface)] px-4 py-3 ${disabled ? 'opacity-55' : ''}`}>
    <span className="min-w-0 flex-1"><span className="block font-bold text-[var(--sf-text)]">{label}</span><span className="mt-0.5 block text-sm leading-5 text-[var(--sf-text-muted)]">{description}</span></span>
    <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} className="h-6 w-11 shrink-0 accent-[var(--sf-brand)]" />
  </label>;
}

export default function SettingsScreen({ headingRef, focusIntent = 0 }: SettingsScreenProps) {
  const { family, mode, followSystem, setFamily, setMode, setFollowSystem } = useTheme();
  const [reducedMotion, setReducedMotion] = useUserReducedMotion();
  const { isSoundEnabled, setSoundEnabled } = useSoundSettings();
  const { isHapticsEnabled, setHapticsEnabled } = useHapticsSettings();
  const [lumiEnabled, setLumiEnabled] = useState(readLumiEnabled);

  useLayoutEffect(() => {
    if (focusIntent > 0) headingRef?.current?.focus({ preventScroll: true });
  }, [focusIntent, headingRef]);
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

  return <div className="settings-screen mx-auto w-full max-w-6xl space-y-6 pb-24 sm:space-y-8">
    <header className="settings-heading max-w-2xl">
      <span className="premium-kicker flex items-center gap-2 uppercase tracking-[0.16em]"><Sparkles size={14} aria-hidden="true" /><Trans id="settings.kicker" message="Settings" /></span>
      <h1 ref={headingRef} tabIndex={-1} className="mt-2 text-balance text-3xl font-black tracking-tight text-[var(--sf-text)] focus-visible:outline-2 sm:text-5xl"><Trans id="settings.title" message="Make your study space yours" /></h1>
      <p className="mt-3 max-w-xl text-pretty text-[var(--sf-text-muted)]"><Trans id="settings.description" message="Choose a look and tune the details that help you focus." /></p>
    </header>

    <section aria-labelledby="settings-appearance" className="settings-panel rounded-[28px] border border-[var(--sf-border)] bg-[var(--sf-surface-glass)] p-4 shadow-[0_22px_56px_-38px_var(--sf-shadow)] sm:p-6">
      <div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-xl bg-[var(--sf-surface-control)] text-[var(--sf-brand-text)]"><Palette size={20} aria-hidden="true" /></span><div><h2 id="settings-appearance" className="text-xl font-black text-[var(--sf-text)]"><Trans id="settings.appearance.title" message="Appearance" /></h2><p className="mt-1 text-sm text-[var(--sf-text-muted)]"><Trans id="settings.appearance.description" message="Changes apply right away and stay after you return." /></p></div></div>
      <fieldset className="settings-theme-picker mt-6"><legend className="text-sm font-bold text-[var(--sf-text)]"><Trans id="settings.theme.label" message="Theme" /></legend><div className="mt-3 grid gap-3 md:grid-cols-3">
        <ThemeOption kind="midnight" family={family} mode={mode} checked={family === 'classic' && mode === 'dark'} onChange={() => choose('midnight')}><span className="block font-black"><Trans id="settings.theme.midnight" message="Midnight Aurora" /></span><span className="mt-1 block text-xs leading-5 text-[var(--sf-text-muted)]"><Trans id="settings.theme.midnight.description" message="A deep, calm night palette." /></span></ThemeOption>
        <ThemeOption kind="paper" family={family} mode={mode} checked={family === 'classic' && mode === 'light'} onChange={() => choose('paper')}><span className="block font-black"><Trans id="settings.theme.paper" message="Ink & Paper" /></span><span className="mt-1 block text-xs leading-5 text-[var(--sf-text-muted)]"><Trans id="settings.theme.paper.description" message="A warm, bright reading surface." /></span></ThemeOption>
        <ThemeOption kind="crystal" family={family} mode={mode} checked={family === 'crystal'} onChange={() => choose('crystal')}><span className="block font-black"><Trans id="settings.theme.crystal" message="Crystal Star" /></span><span className="mt-1 block text-xs leading-5 text-[var(--sf-text-muted)]"><Trans id="settings.theme.crystal.description" message="A sparkling study space with Lumi." /></span></ThemeOption>
      </div></fieldset>
      {family === 'crystal' && <fieldset className="mt-5"><legend className="text-sm font-bold text-[var(--sf-text)]"><Trans id="settings.crystal-mode.label" message="Crystal Star mode" /></legend><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="flex min-h-11 items-center gap-3 rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface)] px-4 py-3"><input type="radio" name="settings-crystal-mode" checked={mode === 'dark'} onChange={() => setMode('dark')} /><Moon size={18} aria-hidden="true" /><span className="font-bold"><Trans id="settings.crystal-mode.night" message="Starry Night" /></span></label><label className="flex min-h-11 items-center gap-3 rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface)] px-4 py-3"><input type="radio" name="settings-crystal-mode" checked={mode === 'light'} onChange={() => setMode('light')} /><Sun size={18} aria-hidden="true" /><span className="font-bold"><Trans id="settings.crystal-mode.day" message="Prism Day" /></span></label></div></fieldset>}
      <div className="mt-5 grid gap-3 lg:grid-cols-2"><SwitchRow checked={followSystem} label={<><Monitor size={16} className="mr-2 inline" aria-hidden="true" /><Trans id="settings.follow-system.label" message="Follow system" /></>} description={<Trans id="settings.follow-system.description" message="Match your device’s light or dark setting." />} onChange={setFollowSystem} /><SwitchRow checked={reducedMotion} label={<Trans id="settings.reduced-motion.label" message="Reduced motion" />} description={<Trans id="settings.reduced-motion.description" message="Limit movement and animated effects." />} onChange={setReducedMotion} /><SwitchRow checked={lumiEnabled} disabled={family !== 'crystal'} label={<Trans id="settings.lumi.label" message="Lumi" />} description={<Trans id="settings.lumi.description" message="Show your Crystal Star study companion." />} onChange={setLumi} /><SwitchRow checked={isSoundEnabled} label={<><Volume2 size={16} className="mr-2 inline" aria-hidden="true" /><Trans id="settings.sound.label" message="Study sounds" /></>} description={<Trans id="settings.sound.description" message="Play feedback sounds while you study." />} onChange={setSoundEnabled} /><SwitchRow checked={isHapticsEnabled} label={<><Vibrate size={16} className="mr-2 inline" aria-hidden="true" /><Trans id="settings.haptics.label" message="Haptics" /></>} description={<Trans id="settings.haptics.description" message="Feel a light vibration while you study." />} onChange={setHapticsEnabled} /></div>
      <div className="mt-5 flex min-h-16 items-center gap-3 rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-4 text-sm text-[var(--sf-text-muted)]"><span data-settings-lumi><Lumi pose="happy" size={42} /></span><Trans id="settings.preview.note" message="Your choices are shown in the live previews above." /></div>
    </section>

    <Suspense fallback={null}><CourseSettingsSection /></Suspense>
  </div>;
}
