import { createContext, useContext, type ReactNode } from 'react';
import type { AccountProfileRecord } from '../../../functions/src/account-profile-contract';
import { useApplyProfileLocale } from '../../i18n/I18nProvider';
import type { CourseNativeLanguage } from '../courses/courseModel';

const AccountProfileContext = createContext<AccountProfileRecord | null>(null);

/** Makes the signed-in owner's completed account profile available below the app shell. */
export function AccountProfileProvider({ profile, children }: { profile: AccountProfileRecord | null; children: ReactNode }) {
  useApplyProfileLocale(profile?.uiLocale);
  return <AccountProfileContext.Provider value={profile}>{children}</AccountProfileContext.Provider>;
}

/** The native language chosen at profile completion, used as the default for new courses. */
export const useAccountProfileNativeLanguage = (): CourseNativeLanguage | null =>
  useContext(AccountProfileContext)?.nativeLanguage ?? null;
