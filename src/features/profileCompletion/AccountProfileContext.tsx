import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import {
  ACCOUNT_UI_LOCALES,
  type AccountProfileRecord,
  type AccountUiLocale,
} from '../../../functions/src/account-profile-contract';
import { useApplyProfileLocale, useUiLocale } from '../../i18n/I18nProvider';
import { UI_LOCALE_STORAGE_KEY } from '../../i18n/locales';
import type { CourseNativeLanguage } from '../courses/courseModel';

const AccountProfileContext = createContext<AccountProfileRecord | null>(null);

/**
 * Stores a language the learner chooses after the profile is complete, so another device with no saved
 * choice applies it. Only a change of the active language counts, and one that differs from what the
 * account already holds: the account language applied on this device, or a language this device started
 * with, is never written back. A language another open tab stored reaches this tab as a storage event:
 * that tab already saved it, so this tab neither saves it nor trusts its own copy of the account language.
 */
function useSaveChosenUiLocale(
  accountLocale: AccountUiLocale | undefined,
  saveUiLocale: ((uiLocale: AccountUiLocale) => void) | undefined,
) {
  const locale = useUiLocale();
  const previous = useRef(locale);
  const requested = useRef<AccountUiLocale | undefined>(undefined);
  const latest = useRef({ accountLocale, saveUiLocale });
  latest.current = { accountLocale, saveUiLocale };
  const fromOtherTab = useRef<AccountUiLocale | undefined>(undefined);
  useEffect(() => { requested.current = undefined; }, [accountLocale]);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== UI_LOCALE_STORAGE_KEY) return;
      if (!event.newValue || !(ACCOUNT_UI_LOCALES as readonly string[]).includes(event.newValue)) return;
      fromOtherTab.current = event.newValue as AccountUiLocale;
      requested.current = event.newValue as AccountUiLocale;
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  useEffect(() => {
    if (previous.current === locale) return;
    previous.current = locale;
    const external = fromOtherTab.current;
    fromOtherTab.current = undefined;
    if (locale === external) return;
    const { accountLocale: stored, saveUiLocale: save } = latest.current;
    if (!stored || !save || !(ACCOUNT_UI_LOCALES as readonly string[]).includes(locale)) return;
    if (locale === (requested.current ?? stored)) return;
    requested.current = locale as AccountUiLocale;
    save(locale as AccountUiLocale);
  }, [locale]);
}

/** Makes the signed-in owner's completed account profile available below the app shell. */
export function AccountProfileProvider({ profile, saveUiLocale, children }: {
  profile: AccountProfileRecord | null;
  saveUiLocale?: (uiLocale: AccountUiLocale) => void;
  children: ReactNode;
}) {
  useApplyProfileLocale(profile?.uiLocale);
  useSaveChosenUiLocale(profile?.uiLocale, saveUiLocale);
  return <AccountProfileContext.Provider value={profile}>{children}</AccountProfileContext.Provider>;
}

/** The native language chosen at profile completion, used as the default for new courses. */
export const useAccountProfileNativeLanguage = (): CourseNativeLanguage | null =>
  useContext(AccountProfileContext)?.nativeLanguage ?? null;
