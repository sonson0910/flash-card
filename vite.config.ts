import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { sharedDeviceStorePlugin } from './dev/sharedDeviceStoreAdapter';

const runtimeSourceId = path.resolve(__dirname, 'src/app/AppRuntime.tsx');
const runtimeInitialId = path.resolve(__dirname, 'src/app/AppRuntimeInitial.virtual.tsx');
const runtimeRetryId = path.resolve(__dirname, 'src/app/AppRuntimeRetry.virtual.tsx');

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
    return fs.readFileSync(runtimeSourceId, 'utf8');
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
