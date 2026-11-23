import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import {
  ACCOUNT_UI_LOCALES,
  type AccountProfileRecord,
  type AccountUiLocale,
} from '../../../functions/src/account-profile-contract';
import { useApplyProfileLocale, useUiLocale } from '../../i18n/I18nProvider';
import type { CourseNativeLanguage } from '../courses/courseModel';

const AccountProfileContext = createContext<AccountProfileRecord | null>(null);

/**
 * Stores a language the learner chooses after the profile is complete, so another device with no saved
 * choice applies it. Only a change of the active language counts, and one that differs from what the
 * account already holds: the account language applied on this device, or a language this device started
 * with, is never written back.
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
  useEffect(() => { requested.current = undefined; }, [accountLocale]);
  useEffect(() => {
    if (previous.current === locale) return;
    previous.current = locale;
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
