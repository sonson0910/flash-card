import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, transformWithEsbuild, type Plugin } from 'vite';
import { sharedDeviceStorePlugin } from './dev/sharedDeviceStoreAdapter';

const runtimeSourceId = path.resolve(__dirname, 'src/app/AppRuntime.tsx');
const runtimeInitialId = '\0AppRuntimeInitial.virtual.tsx';
const runtimeRetryId = '\0AppRuntimeRetry.virtual.tsx';

const appRuntimeVariantsPlugin = (): Plugin => ({
  name: 'app-runtime-variants',
  enforce: 'pre',
  async resolveId(source, importer) {
    if (source.endsWith('/AppRuntimeInitial.virtual')) return runtimeInitialId;
    if (source.endsWith('/AppRuntimeRetry.virtual')) return runtimeRetryId;
    if ((importer === runtimeInitialId || importer === runtimeRetryId) && source.startsWith('.')) {
      return this.resolve(source, runtimeSourceId, { skipSelf: true });
    }
    return null;
  },
  async load(id) {
    if (id !== runtimeInitialId && id !== runtimeRetryId) return null;
    return transformWithEsbuild(fs.readFileSync(runtimeSourceId, 'utf8'), id, { loader: 'tsx', jsx: 'automatic' });
  },
});

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), sharedDeviceStorePlugin(), appRuntimeVariantsPlugin()],
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
        ignored: ['**/.lingoflash-device-sync/**'],
      },
    },
    build: {
      target: 'es2020',
      sourcemap: false,
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          chunkFileNames(chunk) {
            const name = chunk.name.startsWith('_AppRuntime') ? chunk.name.slice(1) : chunk.name;
            return `assets/${name}-[hash].js`;
          },
          manualChunks(id) {
            if (
              id.includes('/node_modules/react/')
              || id.includes('/node_modules/react-dom/')
              || id.includes('/node_modules/scheduler/')
            ) return 'react';
            if (id.includes('/node_modules/firebase/functions') || id.includes('/node_modules/@firebase/functions')) {
              return 'firebase-functions';
            }
            if (id.includes('/node_modules/firebase/') || id.includes('/node_modules/@firebase/')) return 'firebase';
            if (id.includes('/node_modules/motion') || id.includes('/node_modules/framer-motion')) return 'motion';
            return undefined;
          },
        },
      },
    },
  };
});
