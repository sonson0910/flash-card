declare module '*/offline-shell.mjs' {
  export interface OfflineShellAsset {
    readonly url: string;
    readonly sha256: string;
    readonly bytes: number;
  }

  export interface OfflineShellDescriptor {
    readonly revision: string;
    readonly fingerprint: string;
    readonly assets: readonly OfflineShellAsset[];
  }

  export const OFFLINE_SHELL_MAX_BYTES: number;
  export const OFFLINE_SHELL_DESCRIPTOR_MARKER: string;

  export function assertOfflineShellDescriptor(
    descriptor: OfflineShellDescriptor,
  ): OfflineShellDescriptor;

  export function createOfflineShellDescriptor(options?: {
    readonly distDirectory?: string;
    readonly revision?: string;
    readonly assetUrls?: readonly string[];
    readonly assetPaths?: readonly string[];
    readonly maximumBytes?: number;
  }): OfflineShellDescriptor;

  export function renderOfflineServiceWorker(
    template: string,
    descriptor: OfflineShellDescriptor,
  ): string;
}
