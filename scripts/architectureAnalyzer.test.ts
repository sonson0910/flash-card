import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  analyzeArchitecture,
  analyzeSourceModules,
  createCurrentRepoArchitectureConfig,
  createFeatureAppBoundaryRule,
  createPresentationBoundaryRule,
  createPresentationArchitectureConfig,
  INFRASTRUCTURE_IMPORT_PATTERN,
  FEATURE_APP_IMPORT_PATTERN,
} from './architectureAnalyzer';

describe('architecture analyzer', () => {
  it('reports cycles, forbidden imports, and configurable module line limits', () => {
    const report = analyzeSourceModules({
      sources: {
        'src/presentation/A.ts': [
          "import { b } from './B';",
          "import 'firebase/firestore';",
          "import { save } from '../lib/cardRepository';",
          'export const a = b;',
        ].join('\n'),
        'src/presentation/B.ts': [
          "export { c } from './C';",
          'export const b = 1;',
        ].join('\n'),
        'src/presentation/C.ts': [
          "const lazyA = () => import('./A');",
          'export const c = lazyA;',
        ].join('\n'),
        'src/lib/cardRepository.ts': 'export const save = () => undefined;',
      },
      forbiddenImports: [{
        name: 'presentation-domain-boundary',
        from: /^src\/presentation\//,
        imports: /^(?:firebase(?:\/.*)?|.*(?:Repository|repository)(?:\.[^/]*)?)$/,
      }],
      maxLines: { 'src/presentation/A.ts': 3 },
    });

    expect(report.cycles).toEqual([
      ['src/presentation/A.ts', 'src/presentation/B.ts', 'src/presentation/C.ts', 'src/presentation/A.ts'],
    ]);
    expect(report.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'forbidden-import', file: 'src/presentation/A.ts', importPath: 'firebase/firestore', line: 2 }),
      expect.objectContaining({ kind: 'forbidden-import', file: 'src/presentation/A.ts', importPath: '../lib/cardRepository', line: 3 }),
      expect.objectContaining({ kind: 'max-lines', file: 'src/presentation/A.ts', actual: 4, maximum: 3 }),
    ]));
    expect(report.modules.find(module => module.file === 'src/presentation/C.ts')).toEqual({
      file: 'src/presentation/C.ts',
      lineCount: 2,
      imports: ['./A'],
    });
  });

  it('resolves extensionless and index imports without treating packages as graph edges', () => {
    const report = analyzeSourceModules({
      sources: {
        'src/a.ts': "import './folder';\nimport 'react';",
        'src/folder/index.ts': "import '../a.js';",
      },
    });

    expect(report.cycles).toEqual([
      ['src/a.ts', 'src/folder/index.ts', 'src/a.ts'],
    ]);
  });

  it('reports a feature importing an app module as a dependency-direction violation', () => {
    const report = analyzeSourceModules({
      sources: {
        'src/main.tsx': "import './features/Live';",
        'src/features/Live.ts': "import '../app/runtime';",
        'src/app/runtime.ts': 'export const runtime = true;',
      },
      forbiddenImports: [createFeatureAppBoundaryRule()],
      entrypoints: ['src/main.tsx'],
    });

    expect(report.violations).toContainEqual(expect.objectContaining({
      kind: 'forbidden-import',
      rule: 'features-must-not-import-app',
      file: 'src/features/Live.ts',
      importPath: '../app/runtime',
      line: 1,
    }));
    expect(report.cycles).toEqual([]);
  });

  it('normalizes relative import paths before enforcing feature-to-app direction', () => {
    const report = analyzeSourceModules({
      sources: {
        'src/main.tsx': "import './features/Live';",
        'src/features/Live.ts': [
          "import './../app/runtime';",
          "import '../fixtures/../app/runtime';",
          "import '../../app/runtime';",
        ].join('\n'),
        'src/app/runtime.ts': 'export const runtime = true;',
      },
      forbiddenImports: [createFeatureAppBoundaryRule()],
      entrypoints: ['src/main.tsx'],
    });

    expect(report.violations.filter(violation => violation.kind === 'forbidden-import'))
      .toHaveLength(2);
    expect(report.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'forbidden-import',
        file: 'src/features/Live.ts',
        importPath: './../app/runtime',
        line: 1,
      }),
      expect.objectContaining({
        kind: 'forbidden-import',
        file: 'src/features/Live.ts',
        importPath: '../fixtures/../app/runtime',
        line: 2,
      }),
    ]));
  });

  it('excludes import-type and export-type edges from runtime reachability', () => {
    const report = analyzeSourceModules({
      sources: {
        'src/main.tsx': "import './features/Live';",
        'src/features/Live.ts': [
          "import type { Runtime } from '../app/runtimeTypes';",
          "export type { Runtime } from '../app/runtimeTypes';",
          'export const live = true;',
        ].join('\n'),
        'src/app/runtimeTypes.ts': 'export interface Runtime { ready: boolean }\nexport const runtimeMarker = true;',
      },
      entrypoints: ['src/main.tsx'],
    });

    expect(report.reachability.reachable).not.toContain('src/app/runtimeTypes.ts');
    expect(report.reachability.unreachable).toContain('src/app/runtimeTypes.ts');
    expect(report.cycles).toEqual([]);
  });

  it('protects the real CatalogWorkspace reverse-dependency boundary', () => {
    const report = analyzeSourceModules({
      sources: {
        'src/main.tsx': "import './features/catalogWorkspace/CatalogWorkspace';",
        'src/features/catalogWorkspace/CatalogWorkspace.tsx':
          "import { catalogRuntime } from '../../app/catalogRuntime';\nexport const workspace = catalogRuntime;",
        'src/app/catalogRuntime.ts': 'export const catalogRuntime = true;',
      },
      forbiddenImports: [createFeatureAppBoundaryRule()],
      entrypoints: ['src/main.tsx'],
    });

    expect(report.violations).toContainEqual(expect.objectContaining({
      kind: 'forbidden-import',
      rule: 'features-must-not-import-app',
      file: 'src/features/catalogWorkspace/CatalogWorkspace.tsx',
      importPath: '../../app/catalogRuntime',
      line: 1,
    }));
  });

  it('reports an orphan production module while allowing an explicit worker root', () => {
    const report = analyzeSourceModules({
      sources: {
        'src/main.tsx': "import './features/Live';",
        'src/features/Live.ts': 'export const live = true;',
        'src/components/shell/DeadNavigation.tsx': 'export const dead = true;',
        'src/workers/catalogWorker.ts': 'export const worker = true;',
      },
      entrypoints: ['src/main.tsx'],
      reachabilityAllowlist: ['src/workers/catalogWorker.ts'],
    });

    expect(report.reachability).toMatchObject({
      entrypoints: ['src/main.tsx', 'src/workers/catalogWorker.ts'],
      unreachable: ['src/components/shell/DeadNavigation.tsx'],
      missingEntrypoints: [],
    });
    expect(report.violations).toContainEqual({
      kind: 'unreachable-module',
      file: 'src/components/shell/DeadNavigation.tsx',
    });
    expect(report.reachability.unreachable).not.toContain('src/workers/catalogWorker.ts');
  });

  it('treats a string dynamic import as reachable and rejects missing roots', () => {
    const report = analyzeSourceModules({
      sources: {
        'src/main.tsx': "const load = () => import('./features/Deferred');",
        'src/features/Deferred.ts': 'export const deferred = true;',
      },
      entrypoints: ['src/main.tsx'],
      reachabilityAllowlist: ['src/workers/missing.ts'],
    });

    expect(report.reachability.unreachable).toEqual([]);
    expect(report.reachability.missingEntrypoints).toEqual(['src/workers/missing.ts']);
    expect(report.violations).toContainEqual({
      kind: 'missing-entrypoint',
      file: 'src/workers/missing.ts',
    });
  });

  it('keeps production acyclic and enforces the final App presentation boundary', () => {
    const rootDir = fileURLToPath(new URL('..', import.meta.url));
    const config = createCurrentRepoArchitectureConfig(rootDir, {
      includeApp: true,
      appMaxLines: 450,
    });
    const report = analyzeArchitecture(config);

    expect(report.modules.length).toBeGreaterThan(0);
    expect(report.modules.some(module => module.file === 'src/App.tsx')).toBe(true);
    expect(report.modules.some(module => /\.(?:test|spec)\./.test(module.file))).toBe(false);
    expect(report.cycles).toEqual([]);
    expect(report.violations.filter(violation => violation.kind !== 'unreachable-module')).toEqual([]);
    expect(report.reachability.unreachable).toEqual([]);
  });

  it.each([
    'firebase',
    'firebase/firestore',
    '@firebase/firestore',
    '../lib/firebase',
    '@/lib/cardRepository',
    '../librarySession/cloudLibraryPageFirebaseAdapter',
    '../repositories/cards',
  ])('blocks infrastructure import %s from presentation', importPath => {
    expect(INFRASTRUCTURE_IMPORT_PATTERN.test(importPath)).toBe(true);
  });

  it('scopes the boundary to components and feature TSX while App remains opt-in', () => {
    const currentBoundary = createPresentationBoundaryRule(false);
    const finalBoundary = createPresentationBoundaryRule(true);
    const matches = (pattern: RegExp, value: string) => {
      pattern.lastIndex = 0;
      return pattern.test(value);
    };

    expect(matches(currentBoundary.from, 'src/components/shell/AppFooter.tsx')).toBe(true);
    expect(matches(currentBoundary.from, 'src/components/shell/shellTypes.ts')).toBe(true);
    expect(matches(currentBoundary.from, 'src/features/library/LibraryScreen.tsx')).toBe(true);
    expect(matches(currentBoundary.from, 'src/features/library/libraryViewModel.ts')).toBe(false);
    expect(matches(currentBoundary.from, 'src/App.tsx')).toBe(false);
    expect(matches(finalBoundary.from, 'src/App.tsx')).toBe(true);
  });

  it('matches feature-to-app imports in both source-relative and repo-relative forms', () => {
    const rule = createFeatureAppBoundaryRule();
    const matches = (pattern: RegExp, value: string) => {
      pattern.lastIndex = 0;
      return pattern.test(value);
    };

    expect(matches(rule.from, 'src/features/catalogWorkspace/CatalogWorkspace.tsx')).toBe(true);
    expect(matches(rule.imports, '../app/runtime')).toBe(true);
    expect(matches(rule.imports, '../../app/catalogRuntime')).toBe(true);
    expect(matches(FEATURE_APP_IMPORT_PATTERN, 'src/app/catalogRuntime')).toBe(true);
    expect(matches(FEATURE_APP_IMPORT_PATTERN, '@/app/catalogRuntime')).toBe(true);
    expect(matches(rule.imports, '../catalogCache/catalogCache')).toBe(false);
  });

  it('keeps the App size gate explicit and configurable', () => {
    const rootDir = fileURLToPath(new URL('..', import.meta.url));

    expect(createPresentationArchitectureConfig(rootDir).maxLines).toEqual({});
    expect(createPresentationArchitectureConfig(rootDir, {
      includeApp: true,
      appMaxLines: 450,
    })).toMatchObject({
      includePaths: ['src'],
      maxLines: { 'src/App.tsx': 450 },
    });
  });
});
