export const LUMI_ENABLED_STORAGE_KEY = 'sonflash_lumi_enabled';

type LumiStorage = Pick<Storage, 'getItem' | 'setItem'>;
type LumiRoot = Pick<HTMLElement, 'dataset'>;

const getStorage = (): LumiStorage | null => {
  try { return globalThis.localStorage; } catch { return null; }
};

const getRoot = (): LumiRoot | null => globalThis.document?.documentElement ?? null;

export const readLumiEnabled = (storage: Pick<LumiStorage, 'getItem'> | null = getStorage()): boolean => {
  try { return storage?.getItem(LUMI_ENABLED_STORAGE_KEY) !== 'false'; } catch { return true; }
};

export const applyLumiEnabled = (
  enabled: boolean,
  storage: Pick<LumiStorage, 'setItem'> | null = getStorage(),
  root: LumiRoot | null = getRoot(),
): void => {
  try { storage?.setItem(LUMI_ENABLED_STORAGE_KEY, String(enabled)); } catch { /* The setting remains active for this view. */ }
  if (root) root.dataset.lumi = enabled ? 'on' : 'off';
};
