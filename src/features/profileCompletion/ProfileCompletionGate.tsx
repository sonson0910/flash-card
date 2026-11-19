import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
import { Trans, useLingui } from '@lingui/react';
import { ChevronLeft, CircleCheck, X } from 'lucide-react';
import { APPLICATION_SUPPORT_HREF } from '../../components/ApplicationErrorPanel';
import { useSetUiLocale, useUiLocale } from '../../i18n/I18nProvider';
import { UI_LOCALES } from '../../i18n/locales';
import { NATIVE_LANGUAGE_LABEL } from '../courses/courseLanguageLabels';
import type { CourseNativeLanguage } from '../courses/courseModel';
import { useTheme } from '../theme/ThemeProvider';
import { ACCOUNT_NATIVE_LANGUAGES, ACCOUNT_UI_LOCALES, type AccountUiLocale } from '../../../functions/src/account-profile-contract';
import { AccountProfileError } from './accountProfilePort';
import {
  accountProfileSubmission,
  birthYearProblem,
  defaultNativeLanguageFor,
  isAccountNativeLanguage,
  isAccountUiLocale,
  type BirthYearProblem,
} from './accountProfileForm';
import type { AccountProfileGate } from './useAccountProfileGate';
import './profile-completion.css';

export type ProfileGateScreen = 'required' | 'restricted' | 'error';

export interface ProfileCompletionGateProps {
  readonly screen: ProfileGateScreen;
  readonly submit: AccountProfileGate['submit'];
  readonly retry: AccountProfileGate['retry'];
  /** The heading of the screen the learner was opening; it opens after the profile is saved. */
  readonly returnLabel: string;
  readonly onSignOut: () => void | Promise<void>;
}

type Family = 'classic' | 'crystal';
type FamilyCopy = Readonly<Record<Family, MessageDescriptor>>;

const COMPLETE_TITLE: FamilyCopy = {
  classic: msg({ id: 'profile-completion.title', message: 'Make SonFlash yours.' }),
  crystal: msg({ id: 'profile-completion.title.crystal', message: 'Make it yours' }),
};
const RESTRICTED_TITLE: FamilyCopy = {
  classic: msg({ id: 'profile-completion.restricted.title', message: 'We cannot create this account yet.' }),
  crystal: msg({ id: 'profile-completion.restricted.title.crystal', message: 'Account creation paused' }),
};
const OUTCOMES_TITLE: FamilyCopy = {
  classic: msg({ id: 'profile-completion.outcomes.title', message: 'Keep the next step visible.' }),
  crystal: msg({ id: 'profile-completion.outcomes.title.crystal', message: 'Keep the next action clear.' }),
};
const RETURN_PRESERVED: FamilyCopy = {
  classic: msg({ id: 'profile-completion.return.preserved', message: 'Return location preserved · {location}' }),
  crystal: msg({ id: 'profile-completion.return.preserved.crystal', message: 'Return anchor · {location}' }),
};

const BIRTH_YEAR_PROBLEM: Readonly<Record<BirthYearProblem | 'rejected', MessageDescriptor>> = {
  format: msg({ id: 'profile-completion.birth-year.format', message: 'Enter your birth year as four digits, for example 1994.' }),
  future: msg({ id: 'profile-completion.birth-year.future', message: 'The birth year cannot be in the future.' }),
  implausible: msg({ id: 'profile-completion.birth-year.implausible', message: 'Check the birth year. It is too far in the past.' }),
  rejected: msg({ id: 'profile-completion.birth-year.rejected', message: 'Check your birth year and try again.' }),
};

const SUBMIT_PROBLEM: Readonly<Record<'consent-outdated' | 'rate-limited' | 'save-failed', MessageDescriptor>> = {
  'consent-outdated': msg({ id: 'profile-completion.error.consent-outdated', message: 'The terms or the privacy policy changed. Reload the page to review them.' }),
  'rate-limited': msg({ id: 'profile-completion.error.rate-limited', message: 'Too many attempts. Wait a while, then try again.' }),
  'save-failed': msg({ id: 'profile-completion.error.save-failed', message: 'We could not save your details. Check your connection and try again.' }),
};

const legalLinkClass = 'profile-gate__link';

function BrandMark({ family }: { family: Family }) {
  return <span className="claude-brand profile-gate__brand" aria-label="SonFlash" role="img">
    <span className="claude-brand-classic" aria-hidden="true"><Trans {...msg({ context: 'shell.brand.mark', message: 'S' })} /></span>
    <svg viewBox="0 0 100 100" width="36" height="36" aria-hidden="true" className="claude-brand-star profile-gate__star">
      <path d="M50 4 62 36 96 37 69 59 78 91 50 72 22 91 31 59 4 37 38 36Z" />
      <path d="M50 4 62 36 96 37 69 59 78 91 50 72Z" />
    </svg>
    <span className="claude-brand-name" aria-hidden="true"><span>{family === 'crystal' ? 'SON' : 'Son'}</span><em>{family === 'crystal' ? 'FLASH' : 'Flash'}</em></span>
  </span>;
}

function GateFrame({ family, returnStatus, onSignOut, signOutDisabled, footer, children }: {
  family: Family;
  returnStatus: ReactNode;
  onSignOut: () => void;
  signOutDisabled: boolean;
  footer: ReactNode;
  children: ReactNode;
}) {
  const { _ } = useLingui();
  return <div className="profile-gate app-canvas">
    <header className="profile-gate__bar">
      <BrandMark family={family} />
      <span className="profile-gate__pill crystal-chamfer-sm"><Trans {...msg({ id: 'profile-completion.account-access', message: 'Account access' })} /></span>
      <div className="profile-gate__bar-end">
        {returnStatus}
        <button type="button" className="profile-gate__close crystal-chamfer-sm" disabled={signOutDisabled} onClick={onSignOut}
          aria-label={_(msg({ id: 'profile-completion.sign-out', message: 'Sign out' }))}>
          <X aria-hidden="true" size={18} className="profile-gate__close-desktop" />
          <ChevronLeft aria-hidden="true" size={20} className="profile-gate__close-mobile" />
        </button>
      </div>
    </header>
    <main className="profile-gate__main">{children}</main>
    <footer className="profile-gate__footer">
      {footer}
      <a className={legalLinkClass} href={APPLICATION_SUPPORT_HREF}><Trans {...msg({ id: 'profile-completion.help', message: 'Need help?' })} /></a>
    </footer>
  </div>;
}

/** Moves focus to the screen heading when the screen changes, so the new state is announced. */
function useHeadingFocus(key: string) {
  const ref = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    ref.current?.focus();
  }, [key]);
  return ref;
}

/**
 * The account profile step shown after Google sign-in and before any app screen. It sends the form to
 * the server, which alone decides the age rule; a restricted account sees only the sign-out path.
 */
export function ProfileCompletionGate({ screen, submit, retry, returnLabel, onSignOut }: ProfileCompletionGateProps) {
  const { _ } = useLingui();
  const { family } = useTheme();
  const headingRef = useHeadingFocus(screen);
  const [signingOut, setSigningOut] = useState(false);
  const signOut = () => {
    if (signingOut) return;
    setSigningOut(true);
    void Promise.resolve(onSignOut()).finally(() => setSigningOut(false));
  };

  if (screen === 'error') {
    return <GateFrame family={family} returnStatus={null} onSignOut={signOut} signOutDisabled={signingOut} footer={null}>
      <section className="profile-gate__sheet profile-gate__sheet--single max-md:crystal-chamfer max-md:surface-glass" aria-labelledby="profile-gate-title">
        <div className="profile-gate__intro">
          <p className="profile-gate__eyebrow"><Trans {...msg({ id: 'profile-completion.account-access', message: 'Account access' })} /></p>
          <h1 id="profile-gate-title" ref={headingRef} tabIndex={-1} className="profile-gate__title"><Trans {...msg({ id: 'profile-completion.error.title', message: 'We could not check your account.' })} /></h1>
          <p className="profile-gate__lede"><Trans {...msg({ id: 'profile-completion.error.lede', message: 'Check your connection and try again. Nothing was changed.' })} /></p>
        </div>
        <div className="profile-gate__actions">
          <button type="button" className="profile-gate__primary crystal-chamfer-sm" onClick={retry}><Trans {...msg({ id: 'profile-completion.error.retry', message: 'Try again' })} /></button>
          <button type="button" className="profile-gate__secondary crystal-chamfer-sm" disabled={signingOut} onClick={signOut}><Trans {...msg({ id: 'profile-completion.sign-out', message: 'Sign out' })} /></button>
        </div>
      </section>
    </GateFrame>;
  }

  if (screen === 'restricted') {
    return <GateFrame family={family} returnStatus={null} onSignOut={signOut} signOutDisabled={signingOut} footer={null}>
      <div className="profile-gate__sheet max-md:crystal-chamfer max-md:surface-glass" data-screen="restricted">
        <div className="profile-gate__intro">
          <p className="profile-gate__eyebrow"><Trans {...msg({ id: 'profile-completion.restricted.eyebrow', message: 'Age restricted' })} /></p>
          <h1 id="profile-gate-title" ref={headingRef} tabIndex={-1} className="profile-gate__title">{_(RESTRICTED_TITLE[family])}</h1>
          <p className="profile-gate__lede"><Trans {...msg({ id: 'profile-completion.restricted.lede', message: 'The birth year does not meet the current account age requirement.' })} /></p>
        </div>
        <div className="profile-gate__columns">
          <section className="profile-gate__panel md:crystal-chamfer md:surface-glass" aria-labelledby="profile-gate-status">
            <p className="profile-gate__panel-eyebrow"><Trans {...msg({ id: 'profile-completion.restricted.eyebrow', message: 'Age restricted' })} /></p>
            <h2 id="profile-gate-status" className="profile-gate__panel-title"><Trans {...msg({ id: 'profile-completion.restricted.status', message: 'Account status' })} /></h2>
            <dl className="profile-gate__facts">
              <div className="profile-gate__fact crystal-chamfer-sm">
                <dt><Trans {...msg({ id: 'profile-completion.birth-year', message: 'Birth year' })} /></dt>
                <dd><Trans {...msg({ id: 'profile-completion.restricted.birth-year', message: 'Does not meet requirement' })} /></dd>
              </div>
              <div className="profile-gate__fact crystal-chamfer-sm">
                <dt><Trans {...msg({ id: 'profile-completion.restricted.account', message: 'Account' })} /></dt>
                <dd><Trans {...msg({ id: 'profile-completion.restricted.paused', message: 'Creation paused' })} /></dd>
              </div>
            </dl>
            <p className="profile-gate__note profile-gate__note--warning crystal-chamfer-sm">
              <Trans {...msg({ id: 'profile-completion.restricted.note', message: 'Your birth year was not saved. If it was entered by mistake, contact support.' })} />
            </p>
            <button type="button" className="profile-gate__primary crystal-chamfer-sm" disabled={signingOut} onClick={signOut}>
              <Trans {...msg({ id: 'profile-completion.restricted.return', message: 'Return to sign in' })} />
            </button>
          </section>
          <aside className="profile-gate__panel profile-gate__outcomes md:crystal-chamfer md:surface-glass" aria-labelledby="profile-gate-outcomes">
            <p className="profile-gate__panel-eyebrow"><Trans {...msg({ id: 'profile-completion.outcomes.eyebrow', message: 'Return + outcomes' })} /></p>
            <h2 id="profile-gate-outcomes" className="profile-gate__panel-title">{_(OUTCOMES_TITLE[family])}</h2>
            <div className="profile-gate__tile profile-gate__tile--warning crystal-chamfer-sm">
              <strong><Trans {...msg({ id: 'profile-completion.restricted.gate', message: 'Age gate' })} /></strong>
              <span><Trans {...msg({ id: 'profile-completion.restricted.gate-detail', message: 'Account creation cannot continue.' })} /></span>
            </div>
            <div className="profile-gate__tile crystal-chamfer-sm">
              <strong><Trans {...msg({ id: 'profile-completion.outcomes.return', message: 'Return' })} /></strong>
              <span><Trans {...msg({ id: 'profile-completion.restricted.return-detail', message: 'Sign in' })} /></span>
            </div>
          </aside>
        </div>
      </div>
    </GateFrame>;
  }

  const location = returnLabel;
  return <GateFrame
    family={family}
    returnStatus={<p className="profile-gate__return-status"><span className="profile-gate__dot" aria-hidden="true" />{_({ ...RETURN_PRESERVED[family], values: { location } })}</p>}
    onSignOut={signOut}
    signOutDisabled={signingOut}
    footer={<p className="profile-gate__footer-return"><Trans {...msg({ id: 'profile-completion.return.footer', message: 'Return location · {location}' })} values={{ location }} /></p>}
  >
    <div className="profile-gate__sheet max-md:crystal-chamfer max-md:surface-glass" data-screen="complete">
      <div className="profile-gate__intro">
        <p className="profile-gate__eyebrow"><Trans {...msg({ id: 'profile-completion.eyebrow', message: 'Complete signup · once' })} /></p>
        <h1 id="profile-gate-title" ref={headingRef} tabIndex={-1} className="profile-gate__title">{_(COMPLETE_TITLE[family])}</h1>
        <p className="profile-gate__lede"><Trans {...msg({ id: 'profile-completion.lede', message: 'Set the language details that travel with your account.' })} /></p>
      </div>
      <div className="profile-gate__columns">
        <section className="profile-gate__panel md:crystal-chamfer md:surface-glass" aria-labelledby="profile-gate-details">
          <p className="profile-gate__panel-eyebrow"><Trans {...msg({ id: 'profile-completion.details.eyebrow', message: 'Complete signup' })} /></p>
          <h2 id="profile-gate-details" className="profile-gate__panel-title"><Trans {...msg({ id: 'profile-completion.details.title', message: 'Your account details' })} /></h2>
          <ProfileCompletionForm submit={submit} />
        </section>
        <aside className="profile-gate__panel profile-gate__outcomes md:crystal-chamfer md:surface-glass" aria-labelledby="profile-gate-outcomes">
          <p className="profile-gate__panel-eyebrow"><Trans {...msg({ id: 'profile-completion.outcomes.eyebrow', message: 'Return + outcomes' })} /></p>
          <h2 id="profile-gate-outcomes" className="profile-gate__panel-title">{_(OUTCOMES_TITLE[family])}</h2>
          <p className="profile-gate__tile profile-gate__tile--success crystal-chamfer-sm">
            <CircleCheck aria-hidden="true" size={16} />
            <span>{_({ ...RETURN_PRESERVED[family], values: { location } })}</span>
          </p>
          <div className="profile-gate__tile crystal-chamfer-sm">
            <strong><Trans {...msg({ id: 'profile-completion.outcomes.return', message: 'Return' })} /></strong>
            <span>{location}</span>
          </div>
          <div className="profile-gate__tile profile-gate__tile--next crystal-chamfer-sm">
            <strong><Trans {...msg({ id: 'profile-completion.outcomes.next', message: 'Next' })} /></strong>
            <span><Trans {...msg({ id: 'profile-completion.save', message: 'Save and continue' })} /></span>
          </div>
        </aside>
      </div>
    </div>
  </GateFrame>;
}

function ProfileCompletionForm({ submit }: { submit: AccountProfileGate['submit'] }) {
  const { _ } = useLingui();
  const uiLocale = useUiLocale();
  const setUiLocale = useSetUiLocale();
  const id = useId();
  const birthYearRef = useRef<HTMLInputElement>(null);
  const consentRef = useRef<HTMLInputElement>(null);
  const initialLocale: AccountUiLocale = isAccountUiLocale(uiLocale) ? uiLocale : 'en';
  const [birthYear, setBirthYear] = useState('');
  const [locale, setLocale] = useState<AccountUiLocale>(initialLocale);
  const [nativeLanguage, setNativeLanguage] = useState<CourseNativeLanguage>(() => defaultNativeLanguageFor(initialLocale));
  const [nativeTouched, setNativeTouched] = useState(false);
  const [consent, setConsent] = useState(false);
  const [yearProblem, setYearProblem] = useState<BirthYearProblem | 'rejected' | null>(null);
  const [consentMissing, setConsentMissing] = useState(false);
  const [submitProblem, setSubmitProblem] = useState<keyof typeof SUBMIT_PROBLEM | null>(null);
  const [pending, setPending] = useState(false);
  // The gate is mounted once per signed-in owner, so a form that is gone when the save returns
  // belonged to an account that has since signed out or switched; its result must not touch this device.
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const yearErrorId = `${id}-birth-year-error`;
  const consentHintId = `${id}-consent-hint`;

  const changeLocale = (value: string) => {
    if (!isAccountUiLocale(value)) return;
    setLocale(value);
    if (!nativeTouched) setNativeLanguage(defaultNativeLanguageFor(value));
    void setUiLocale(value);
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const problem = birthYearProblem(birthYear.trim(), new Date());
    setYearProblem(problem);
    setConsentMissing(!consent);
    setSubmitProblem(null);
    if (problem) {
      birthYearRef.current?.focus();
      return;
    }
    if (!consent) {
      consentRef.current?.focus();
      return;
    }
    setPending(true);
    try {
      const outcome = await submit(accountProfileSubmission(birthYear.trim(), locale, nativeLanguage));
      if (!mountedRef.current) return;
      if (outcome.status === 'complete' && isAccountUiLocale(outcome.profile.uiLocale)) {
        void setUiLocale(outcome.profile.uiLocale);
      }
    } catch (error) {
      if (!mountedRef.current) return;
      const code = error instanceof AccountProfileError ? error.code : 'save-failed';
      if (code === 'invalid') {
        setYearProblem('rejected');
        birthYearRef.current?.focus();
      } else {
        setSubmitProblem(code === 'consent-outdated' || code === 'rate-limited' ? code : 'save-failed');
      }
      setPending(false);
    }
  };

  return <form className="profile-gate__form" noValidate onSubmit={event => { void onSubmit(event); }} aria-busy={pending}>
    <div className="profile-gate__fields">
      <div className="profile-gate__field">
        <label htmlFor={`${id}-birth-year`}><Trans {...msg({ id: 'profile-completion.birth-year', message: 'Birth year' })} /></label>
        <input
          ref={birthYearRef}
          id={`${id}-birth-year`}
          name="birthYear"
          className="profile-gate__control crystal-chamfer-sm"
          inputMode="numeric"
          autoComplete="bday-year"
          maxLength={4}
          placeholder={_(msg({ id: 'profile-completion.birth-year.placeholder', message: 'YYYY' }))}
          value={birthYear}
          aria-invalid={yearProblem ? true : undefined}
          aria-describedby={yearProblem ? yearErrorId : undefined}
          onChange={event => {
            setBirthYear(event.target.value.replace(/\D/g, '').slice(0, 4));
            if (yearProblem) setYearProblem(null);
          }}
        />
        {yearProblem && <p id={yearErrorId} className="profile-gate__error">{_(BIRTH_YEAR_PROBLEM[yearProblem])}</p>}
      </div>
      <div className="profile-gate__field">
        <label htmlFor={`${id}-locale`}><Trans {...msg({ id: 'profile-completion.locale', message: 'App language' })} /></label>
        <select id={`${id}-locale`} name="uiLocale" className="profile-gate__control crystal-chamfer-sm" value={locale} onChange={event => changeLocale(event.target.value)}>
          {ACCOUNT_UI_LOCALES.map(option => <option key={option} value={option} lang={option}>{UI_LOCALES[option].autonym}</option>)}
        </select>
      </div>
      <div className="profile-gate__field">
        <label htmlFor={`${id}-native`}><Trans {...msg({ id: 'profile-completion.native-language', message: 'Native language' })} /></label>
        <select id={`${id}-native`} name="nativeLanguage" className="profile-gate__control crystal-chamfer-sm" value={nativeLanguage}
          onChange={event => {
            if (!isAccountNativeLanguage(event.target.value)) return;
            setNativeLanguage(event.target.value);
            setNativeTouched(true);
          }}>
          {ACCOUNT_NATIVE_LANGUAGES.map(option => <option key={option} value={option}>{_(NATIVE_LANGUAGE_LABEL[option])}</option>)}
        </select>
      </div>
    </div>
    <div className="profile-gate__consent" data-invalid={consentMissing && !consent ? 'true' : undefined}>
      <label className="profile-gate__check-target" htmlFor={`${id}-consent`}>
      <input
        ref={consentRef}
        id={`${id}-consent`}
        name="consent"
        type="checkbox"
        className="profile-gate__checkbox"
        checked={consent}
        aria-invalid={consentMissing && !consent ? true : undefined}
        aria-describedby={consentHintId}
        onChange={event => {
          setConsent(event.target.checked);
          if (event.target.checked) setConsentMissing(false);
        }}
      />
      </label>
      <div>
        <label htmlFor={`${id}-consent`}>
          <Trans
            {...msg({ id: 'profile-completion.consent', message: 'I am 18 or older and I agree to the <terms>Terms</terms> and the <privacy>Privacy policy</privacy>.' })}
            components={{
              terms: <a href="/terms.html" target="_blank" rel="noreferrer" className={legalLinkClass} />,
              privacy: <a href="/privacy.html" target="_blank" rel="noreferrer" className={legalLinkClass} />,
            }}
          />
        </label>
        <p id={consentHintId} className="profile-gate__hint"><Trans {...msg({ id: 'profile-completion.consent.required', message: 'Required before continuing.' })} /></p>
      </div>
    </div>
    <p className="profile-gate__note crystal-chamfer-sm">
      <Trans {...msg({ id: 'profile-completion.note', message: 'We keep your birth year only to confirm the 18+ requirement. It is part of your account data download and is removed when you delete the account.' })} />
    </p>
    <div role="alert" className="profile-gate__alert">{submitProblem ? _(SUBMIT_PROBLEM[submitProblem]) : null}</div>
    <button type="submit" className="profile-gate__primary crystal-chamfer-sm" disabled={pending}>
      {pending
        ? <Trans {...msg({ id: 'profile-completion.saving', message: 'Saving…' })} />
        : <Trans {...msg({ id: 'profile-completion.save', message: 'Save and continue' })} />}
    </button>
  </form>;
}
