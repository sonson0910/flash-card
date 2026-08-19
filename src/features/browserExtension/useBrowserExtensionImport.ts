import { useEffect, useRef } from 'react';
import type { BrowserExtensionImportRuntime } from './browserExtensionImportRuntime';
import type { BrowserExtensionImportOptions } from './browserExtensionImportRuntime';

const IMPORT_MARKER = 'lf-import=';
const PENDING_IMPORT_KEY = 'lingoflash_browser_extension_import';

const shouldLoadBrowserExtensionImport = (): boolean => {
  if (globalThis.location?.hash.includes(IMPORT_MARKER)) return true;
  try {
    return Boolean(globalThis.sessionStorage?.getItem(PENDING_IMPORT_KEY));
  } catch {
    return false;
  }
};

export function useBrowserExtensionImport(options: BrowserExtensionImportOptions): void {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const runtimeRef = useRef<BrowserExtensionImportRuntime | null>(null);

  useEffect(() => {
    runtimeRef.current?.update(options);
  });

  useEffect(() => {
    let disposed = false;
    let loading = false;

    const startWhenNeeded = () => {
      if (loading || runtimeRef.current || !shouldLoadBrowserExtensionImport()) return;
      loading = true;
      void import('./browserExtensionImportRuntime').then(module => {
        if (disposed) return;
        runtimeRef.current = module.startBrowserExtensionImportRuntime(optionsRef.current);
      }).catch(() => {
        loading = false;
      });
    };

    startWhenNeeded();
    globalThis.addEventListener?.('hashchange', startWhenNeeded);
    return () => {
      disposed = true;
      globalThis.removeEventListener?.('hashchange', startWhenNeeded);
      runtimeRef.current?.dispose();
      runtimeRef.current = null;
    };
  }, []);
}
