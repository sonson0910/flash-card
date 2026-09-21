import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { sharedDeviceStorePlugin } from './dev/sharedDeviceStoreAdapter';

const runtimeSourceId = path.resolve(__dirname, 'src/app/AppRuntime.tsx');
const runtimeInitialId = path.resolve(__dirname, 'src/app/AppRuntimeInitial.virtual.tsx');
const runtimeRetryId = path.resolve(__dirname, 'src/app/AppRuntimeRetry.virtual.tsx');

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const appRuntimeVariantsPlugin = (): Plugin => ({
  name: 'app-runtime-variants',
  enforce: 'pre',
  resolveId(source) {
    if (source.endsWith('/AppRuntimeInitial.virtual')) return runtimeInitialId;
    if (source.endsWith('/AppRuntimeRetry.virtual')) return runtimeRetryId;
    return null;
  },
  load(id) {
    if (id !== runtimeInitialId && id !== runtimeRetryId) return null;
    const variant = id === runtimeInitialId ? 'initial' : 'retry';
    return `export { default } from ${JSON.stringify(runtimeSourceId)}; export const runtimeVariant = ${JSON.stringify(variant)};`;
  },
});

const appRuntimeRetryIdentityPlugin = (): Plugin => ({
  name: 'app-runtime-retry-identity',
  apply: 'build',
  renderChunk(code, chunk) {
    if (chunk.facadeModuleId !== runtimeRetryId) return null;
    const runtimeAsset = chunk.imports.find(asset => /(?:^|\/)AppRuntime-[^/]+\.js$/.test(asset));
    if (!runtimeAsset) throw new Error('Missing shared AppRuntime chunk for retry entry.');
    const runtimeSpecifier = runtimeAsset.replace(/^assets\//, '');
    const retryCode = code.replace(
      new RegExp(`(["'])\\./${escapeRegExp(runtimeSpecifier)}\\1`),
      `$1./${runtimeSpecifier}?runtime-retry=1$1`,
    );
    if (retryCode === code) throw new Error('Missing shared AppRuntime import in retry entry.');
    return { code: retryCode, map: null };
  },
});

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), sharedDeviceStorePlugin(), appRuntimeVariantsPlugin(), appRuntimeRetryIdentityPlugin()],
    esbuild: {
      legalComments: 'eof',
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      host: '127.0.0.1',
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: {
        ignored: ['**/.lingoflash-device-sync/**', '**/.worktrees/**'],
      },
    },
    build: {
      target: 'es2020',
      sourcemap: false,
      chunkSizeWarningLimit: 600,
      modulePreload: {
        resolveDependencies(filename, dependencies) {
          if (!/AppRuntimeRetry\.virtual-[^/]+\.js$/.test(filename)) return dependencies;
          return dependencies.filter(dependency => !/(?:^|\/)AppRuntime-[^/]+\.js$/.test(dependency));
        },
      },
      rollupOptions: {
        output: {
          hoistTransitiveImports: false,
          manualChunks(id) {
            if (
              id.includes('/node_modules/react/')
              || id.includes('/node_modules/react-dom/')
              || id.includes('/node_modules/scheduler/')
            ) return 'react';
            if (id.includes('/node_modules/firebase/functions') || id.includes('/node_modules/@firebase/functions')) {
              return 'firebase-functions';
            }
            if (id.includes('/node_modules/firebase/auth') || id.includes('/node_modules/@firebase/auth')) {
              return 'firebase-auth';
            }
            if (id.includes('/node_modules/firebase/firestore') || id.includes('/node_modules/@firebase/firestore')) {
              return 'firebase-firestore';
            }
            if (id.includes('/node_modules/firebase/storage') || id.includes('/node_modules/@firebase/storage')) {
              return 'firebase-storage';
            }
            if (id.includes('/node_modules/firebase/') || id.includes('/node_modules/@firebase/')) return 'firebase';
            return undefined;
          },
        },
      },
    },
  };
});
