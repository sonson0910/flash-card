import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  analyzeArchitecture,
  analyzeSourceModules,
  createCurrentRepoArchitectureConfig,
  createPresentationBoundaryRule,
  createPresentationArchitectureConfig,
  INFRASTRUCTURE_IMPORT_PATTERN,
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

  it('keeps production acyclic and enforces the final App presentation boundary', () => {
    const rootDir = fileURLToPath(new URL('..', import.meta.url));
    const config = createCurrentRepoArchitectureConfig(rootDir, {
      includeApp: true,
      appMaxLines: 600,
    });
    const report = analyzeArchitecture(config);

    expect(report.modules.length).toBeGreaterThan(0);
    expect(report.modules.some(module => module.file === 'src/App.tsx')).toBe(true);
    expect(report.modules.some(module => /\.(?:test|spec)\./.test(module.file))).toBe(false);
    expect(report.cycles).toEqual([]);
    expect(report.violations).toEqual([]);
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

  it('keeps the App size gate explicit and configurable', () => {
    const rootDir = fileURLToPath(new URL('..', import.meta.url));

    expect(createPresentationArchitectureConfig(rootDir).maxLines).toEqual({});
    expect(createPresentationArchitectureConfig(rootDir, {
      includeApp: true,
      appMaxLines: 600,
    })).toMatchObject({
      includePaths: ['src'],
      maxLines: { 'src/App.tsx': 600 },
    });
  });
});
