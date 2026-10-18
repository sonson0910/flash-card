export const ACCOUNT_DELETION_STARTED_NOTICE_STORAGE_KEY = 'sonflash_account_deletion_started_notice';
export const ACCOUNT_DELETION_CACHE_NOTICE_STORAGE_KEY = 'sonflash_account_deletion_cache_notice';
const NOTICE_URL_KEYS = ['sfDeleteStarted', 'sfDeleteCache'] as const;

export const accountDeletionNoticePath = (href: string): string => {
  const url = new URL(href);
  const notice = new URLSearchParams();
  for (const key of NOTICE_URL_KEYS) if (url.searchParams.get(key) === '1') notice.set(key, '1');
  const query = notice.toString();
  return `${url.pathname}${query ? `?${query}` : ''}`;
};

export const withoutAccountDeletionNotices = (href: string): string => {
  const url = new URL(href);
  for (const key of NOTICE_URL_KEYS) url.searchParams.delete(key);
  return url.href;
};

const markNotice = (storageKey: string, urlKey: string): boolean => {
  try {
    globalThis.sessionStorage.setItem(storageKey, '1');
    return true;
  } catch { /* Use the URL when session storage is unavailable. */ }
  try {
    const url = new URL(globalThis.location.href);
    url.searchParams.set(urlKey, '1');
    globalThis.history.replaceState(globalThis.history.state, '', url);
    return true;
  } catch { return false; }
};

const consumeNotice = (storageKey: string, urlKey: string): boolean => {
  let marked = false;
  try {
    marked = globalThis.sessionStorage.getItem(storageKey) === '1';
    if (marked) globalThis.sessionStorage.removeItem(storageKey);
  } catch { /* The URL can carry the notice independently. */ }
  try {
    const url = new URL(globalThis.location.href);
    if (url.searchParams.get(urlKey) === '1') {
      marked = true;
      url.searchParams.delete(urlKey);
      globalThis.history.replaceState(globalThis.history.state, '', url);
    }
  } catch { /* Leave the URL notice available if it cannot be removed. */ }
  return marked;
};

export const markAccountDeletionStartedNotice = (): boolean => markNotice(ACCOUNT_DELETION_STARTED_NOTICE_STORAGE_KEY, 'sfDeleteStarted');
export const consumeAccountDeletionStartedNotice = (): boolean => consumeNotice(ACCOUNT_DELETION_STARTED_NOTICE_STORAGE_KEY, 'sfDeleteStarted');

export const markAccountDeletionCacheNotice = (): boolean => markNotice(ACCOUNT_DELETION_CACHE_NOTICE_STORAGE_KEY, 'sfDeleteCache');
export const consumeAccountDeletionCacheNotice = (): boolean => consumeNotice(ACCOUNT_DELETION_CACHE_NOTICE_STORAGE_KEY, 'sfDeleteCache');
