import tailwindcss from '@tailwindcss/vite';
import { lingui } from '@lingui/vite-plugin';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import productionFirebaseConfig from './firebase-applet-config.json';

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

export const resolveBuildTarget = (mode: string) => {
  const environment = loadEnv(mode, process.cwd(), '');
  // Only the process environment selects the Firebase project; a dotenv value that disagrees
  // with it is rejected instead of silently retargeting the build.
  const target = process.env.SONFLASH_TARGET?.trim() || 'production';
  const fileTarget = environment.SONFLASH_TARGET?.trim();
  if (fileTarget && fileTarget !== target) {
    throw new Error(`SONFLASH_TARGET=${fileTarget} in a dotenv file conflicts with the ${target} build target.`);
  }
  if (target === 'production') {
    return {
      firebaseConfig: productionFirebaseConfig,
      appCheckSiteKey: environment.VITE_FIREBASE_APP_CHECK_SITE_KEY?.trim() ?? '',
    };
  }
  if (target !== 'staging') throw new Error(`Unsupported SONFLASH_TARGET: ${target}`);
  const stagingConfigPath = path.resolve(__dirname, 'firebase-targets/staging.json');
  const stagingConfig = JSON.parse(fs.readFileSync(stagingConfigPath, 'utf8')) as typeof productionFirebaseConfig & {
    appId?: string;
    appCheckSiteKey?: string;
    region?: string;
  };
  if (
    stagingConfig.projectId !== 'sonflash-staging-20260906'
    || stagingConfig.appId !== '1:890120640842:web:f8a858029dc582fc7e49b3'
    || stagingConfig.firestoreDatabaseId !== 'ai-studio-945b4052-4462-4668-8936-277f09f07a37'
    || stagingConfig.authDomain !== 'sonflash-staging-20260906.firebaseapp.com'
    || !stagingConfig.apiKey
    || !stagingConfig.appCheckSiteKey
    || stagingConfig.region !== 'asia-southeast1'
  ) {
    throw new Error('The sealed staging Firebase target is incomplete or has an unexpected identity.');
  }
  const { appCheckSiteKey, region: _region, ...firebaseConfig } = stagingConfig;
  return { firebaseConfig, appCheckSiteKey };
};

export default defineConfig(({ mode }) => {
  const buildTarget = resolveBuildTarget(mode);
  return {
    define: {
      'import.meta.env.VITE_SONFLASH_FIREBASE_CONFIG': JSON.stringify(JSON.stringify(buildTarget.firebaseConfig)),
      'import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY': JSON.stringify(buildTarget.appCheckSiteKey),
    },
    plugins: [
      react({ babel: { plugins: ['@lingui/babel-plugin-lingui-macro'] } }),
      lingui(),
      tailwindcss(),
      appRuntimeVariantsPlugin(),
    ],
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
        ignored: ['**/.worktrees/**'],
      },
    },
    build: {
      // The emulator e2e run builds into its own directory so a concurrent
      // production build cannot overwrite the artifact under test.
      outDir: process.env.SONFLASH_BUILD_OUT_DIR || 'dist',
      target: 'es2020',
      minify: 'terser',
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
            return undefined;
          },
        },
      },
    },
  };
});
