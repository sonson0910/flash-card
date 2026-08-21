import { readFileSync, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';

export interface ForbiddenImportRule {
  name: string;
  from: RegExp;
  imports: RegExp;
}

export interface SourceArchitectureInput {
  sources: Readonly<Record<string, string>>;
  forbiddenImports?: readonly ForbiddenImportRule[];
  maxLines?: Readonly<Record<string, number>>;
  /** Primary production roots used to calculate static module reachability. */
  entrypoints?: readonly string[];
  /** Intentional standalone roots such as workers loaded by a host API. */
  reachabilityAllowlist?: readonly string[];
}

export interface ArchitectureConfig {
  rootDir: string;
  includePaths: readonly string[];
  exclude?: readonly RegExp[];
  forbiddenImports?: readonly ForbiddenImportRule[];
  maxLines: Readonly<Record<string, number>>;
  entrypoints?: readonly string[];
  reachabilityAllowlist?: readonly string[];
}

export interface ModuleSizeReport {
  file: string;
  lineCount: number;
  imports: string[];
}

export type ArchitectureViolation =
  | {
    kind: 'forbidden-import';
    rule: string;
    file: string;
    importPath: string;
    line: number;
  }
  | {
    kind: 'max-lines';
    file: string;
    actual: number;
    maximum: number;
  }
  | {
    kind: 'unreachable-module';
    file: string;
  }
  | {
    kind: 'missing-entrypoint';
    file: string;
  };

export interface ArchitectureReachabilityReport {
  entrypoints: string[];
  reachable: string[];
  unreachable: string[];
  missingEntrypoints: string[];
}

export interface ArchitectureReport {
  modules: ModuleSizeReport[];
  cycles: string[][];
  violations: ArchitectureViolation[];
  reachability: ArchitectureReachabilityReport;
}

interface ParsedImport {
  path: string;
  line: number;
  /** Whether this edge can exist in emitted JavaScript. */
  runtime: boolean;
}

const TYPESCRIPT_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'];

const normalizeFile = (file: string): string => file.replaceAll('\\', '/').replace(/^\.\//, '');

const matches = (pattern: RegExp, value: string): boolean => {
  pattern.lastIndex = 0;
  return pattern.test(value);
};

const scriptKindFor = (file: string): ts.ScriptKind =>
  file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;

const isTypeOnlyImportDeclaration = (node: ts.ImportDeclaration): boolean => {
  const clause = node.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  return Boolean(
    clause.namedBindings
    && ts.isNamedImports(clause.namedBindings)
    && clause.namedBindings.elements.length > 0
    && clause.namedBindings.elements.every(element => element.isTypeOnly),
  );
};

const isTypeOnlyExportDeclaration = (node: ts.ExportDeclaration): boolean => {
  if (node.isTypeOnly) return true;
  return Boolean(
    node.exportClause
    && ts.isNamedExports(node.exportClause)
    && node.exportClause.elements.length > 0
    && node.exportClause.elements.every(element => element.isTypeOnly),
  );
};

const isAmbientDeclaration = (node: ts.Node): boolean => {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return Boolean(modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DeclareKeyword));
};

/** TypeScript-only contract files do not produce a production runtime module. */
const hasRuntimeStatements = (sourceFile: ts.SourceFile): boolean => sourceFile.statements.some(statement => {
  if (isAmbientDeclaration(statement)) return false;
  if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) return false;
  if (ts.isImportDeclaration(statement)) return !isTypeOnlyImportDeclaration(statement);
  if (ts.isExportDeclaration(statement)) return !isTypeOnlyExportDeclaration(statement);
  return true;
});

const parseImports = (file: string, source: string): { sourceFile: ts.SourceFile; imports: ParsedImport[] } => {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(file),
  );
  const imports: ParsedImport[] = [];
  const add = (node: ts.Node, value: ts.Expression | undefined, runtime = true) => {
    if (!value || !ts.isStringLiteralLike(value)) return;
    imports.push({
      path: value.text,
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
      runtime,
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      add(node, node.moduleSpecifier, !isTypeOnlyImportDeclaration(node));
    } else if (ts.isExportDeclaration(node)) {
      add(node, node.moduleSpecifier, !isTypeOnlyExportDeclaration(node));
    } else if (
      ts.isImportEqualsDeclaration(node)
      && ts.isExternalModuleReference(node.moduleReference)
    ) {
      add(node, node.moduleReference.expression);
    } else if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      add(node, node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { sourceFile, imports };
};

const resolveRelativeImport = (
  importer: string,
  importPath: string,
  files: ReadonlySet<string>,
): string | null => {
  if (!importPath.startsWith('.')) return null;
  const raw = normalizeFile(path.posix.normalize(path.posix.join(path.posix.dirname(importer), importPath)));
  const extension = path.posix.extname(raw);
  const withoutRuntimeExtension = ['.js', '.jsx', '.mjs', '.cjs'].includes(extension)
    ? raw.slice(0, -extension.length)
    : raw;
  const candidates = [raw];
  for (const typescriptExtension of TYPESCRIPT_EXTENSIONS) {
    candidates.push(`${withoutRuntimeExtension}${typescriptExtension}`);
    candidates.push(`${withoutRuntimeExtension}/index${typescriptExtension}`);
  }
  return candidates.find(candidate => files.has(candidate)) ?? null;
};

const canonicalCycle = (cycle: string[]): string[] => {
  const nodes = cycle.slice(0, -1);
  let best = nodes;
  for (let index = 1; index < nodes.length; index += 1) {
    const rotated = [...nodes.slice(index), ...nodes.slice(0, index)];
    if (rotated.join('\0') < best.join('\0')) best = rotated;
  }
  return [...best, best[0]];
};

const findCycles = (graph: ReadonlyMap<string, readonly string[]>): string[][] => {
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const stack: string[] = [];
  const cycles = new Map<string, string[]>();

  const visit = (file: string) => {
    if (visited.has(file)) return;
    visiting.add(file);
    stack.push(file);
    for (const dependency of graph.get(file) ?? []) {
      if (visiting.has(dependency)) {
        const start = stack.indexOf(dependency);
        const cycle = canonicalCycle([...stack.slice(start), dependency]);
        cycles.set(cycle.join(' -> '), cycle);
      } else {
        visit(dependency);
      }
    }
    stack.pop();
    visiting.delete(file);
    visited.add(file);
  };

  [...graph.keys()].sort().forEach(visit);
  return [...cycles.values()].sort((left, right) => left.join('\0').localeCompare(right.join('\0')));
};

const findReachability = (
  graph: ReadonlyMap<string, readonly string[]>,
  entrypoints: readonly string[],
  reachabilityAllowlist: readonly string[],
): ArchitectureReachabilityReport => {
  const roots = [...new Set([...entrypoints, ...reachabilityAllowlist].map(normalizeFile))].sort();
  if (roots.length === 0) {
    return {
      entrypoints: [],
      reachable: [],
      unreachable: [],
      missingEntrypoints: [],
    };
  }
  const missingEntrypoints = roots.filter(root => !graph.has(root));
  const reachable = new Set<string>();
  const visit = (file: string): void => {
    if (reachable.has(file) || !graph.has(file)) return;
    reachable.add(file);
    (graph.get(file) ?? []).forEach(visit);
  };
  roots.forEach(visit);
  const unreachable = [...graph.keys()].filter(file => !reachable.has(file)).sort();
  return {
    entrypoints: roots,
    reachable: [...reachable].sort(),
    unreachable,
    missingEntrypoints,
  };
};

export function analyzeSourceModules({
  sources,
  forbiddenImports = [],
  maxLines = {},
  entrypoints = [],
  reachabilityAllowlist = [],
}: SourceArchitectureInput): ArchitectureReport {
  const normalizedSources = new Map(
    Object.entries(sources).map(([file, source]) => [normalizeFile(file), source]),
  );
  const files = new Set(normalizedSources.keys());
  const graph = new Map<string, string[]>();
  const modules: ModuleSizeReport[] = [];
  const violations: ArchitectureViolation[] = [];
  const parsedSources = new Map(
    [...normalizedSources.entries()].map(([file, source]) => [file, parseImports(file, source)] as const),
  );
  const runtimeFiles = new Set(
    [...parsedSources.entries()]
      .filter(([, parsed]) => hasRuntimeStatements(parsed.sourceFile))
      .map(([file]) => file),
  );

  for (const [file] of [...normalizedSources.entries()].sort(([left], [right]) =>
    left.localeCompare(right))) {
    const parsed = parsedSources.get(file)!;
    const dependencies = parsed.imports.flatMap(item => {
      const resolved = resolveRelativeImport(file, item.path, files);
      return item.runtime && resolved && runtimeFiles.has(resolved) ? [resolved] : [];
    });
    if (runtimeFiles.has(file)) graph.set(file, [...new Set(dependencies)].sort());
    modules.push({
      file,
      lineCount: parsed.sourceFile.getLineStarts().length,
      imports: parsed.imports.map(item => item.path),
    });

    for (const item of parsed.imports) {
      const resolved = resolveRelativeImport(file, item.path, files);
      const importPathCandidates = [
        normalizeFile(path.posix.normalize(
          item.path.startsWith('.')
            ? path.posix.join(path.posix.dirname(file), item.path)
            : item.path,
        )),
        ...(resolved ? [resolved] : []),
      ];
      for (const rule of forbiddenImports) {
        if (
          matches(rule.from, file)
          && importPathCandidates.some(importPath => matches(rule.imports, importPath))
        ) {
          violations.push({
            kind: 'forbidden-import',
            rule: rule.name,
            file,
            importPath: item.path,
            line: item.line,
          });
        }
      }
    }

    const maximum = maxLines[file];
    if (maximum !== undefined && parsed.sourceFile.getLineStarts().length > maximum) {
      violations.push({
        kind: 'max-lines',
        file,
        actual: parsed.sourceFile.getLineStarts().length,
        maximum,
      });
    }
  }

  const reachability = findReachability(graph, entrypoints, reachabilityAllowlist);
  reachability.unreachable.forEach(file => {
    violations.push({ kind: 'unreachable-module', file });
  });
  reachability.missingEntrypoints.forEach(file => {
    violations.push({ kind: 'missing-entrypoint', file });
  });

  return {
    modules,
    cycles: findCycles(graph),
    violations,
    reachability,
  };
}

const collectFiles = (
  rootDir: string,
  includePaths: readonly string[],
  exclude: readonly RegExp[],
): Record<string, string> => {
  const sources: Record<string, string> = {};
  const visit = (absolutePath: string) => {
    const relativePath = normalizeFile(path.relative(rootDir, absolutePath));
    if (exclude.some(pattern => matches(pattern, relativePath))) return;
    const stats = statSync(absolutePath);
    if (stats.isDirectory()) {
      readdirSync(absolutePath, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name))
        .forEach(entry => visit(path.join(absolutePath, entry.name)));
      return;
    }
    if (!TYPESCRIPT_EXTENSIONS.includes(path.extname(absolutePath))) return;
    sources[relativePath] = readFileSync(absolutePath, 'utf8');
  };

  includePaths.forEach(includePath => visit(path.resolve(rootDir, includePath)));
  return sources;
};

export function analyzeArchitecture(config: ArchitectureConfig): ArchitectureReport {
  return analyzeSourceModules({
    sources: collectFiles(config.rootDir, config.includePaths, config.exclude ?? []),
    forbiddenImports: config.forbiddenImports,
    maxLines: config.maxLines,
    entrypoints: config.entrypoints,
    reachabilityAllowlist: config.reachabilityAllowlist,
  });
}

export const INFRASTRUCTURE_IMPORT_PATTERN = /(?:^@?firebase(?:\/|$)|(?:^|\/)[^/]*(?:firebase|repositor(?:y|ies))[^/]*(?:$|\/))/i;

const presentationSourcePattern = (includeApp: boolean): RegExp => includeApp
  ? /^(?:src\/App\.tsx|src\/components\/|src\/features\/.*\.tsx$)/
  : /^(?:src\/components\/|src\/features\/.*\.tsx$)/;

export function createPresentationBoundaryRule(includeApp = false): ForbiddenImportRule {
  return {
    name: 'presentation-must-use-domain-ports',
    from: presentationSourcePattern(includeApp),
    imports: INFRASTRUCTURE_IMPORT_PATTERN,
  };
}

export const FEATURE_APP_IMPORT_PATTERN = /^(?:\.\.\/)+app(?:\/|$)|^src\/app(?:\/|$)|^@\/app(?:\/|$)/;

export function createFeatureAppBoundaryRule(): ForbiddenImportRule {
  return {
    name: 'features-must-not-import-app',
    from: /^src\/features\//,
    imports: FEATURE_APP_IMPORT_PATTERN,
  };
}

export interface CurrentRepoArchitectureOptions {
  /** Enables App import boundaries. Keep false until the facade integration is complete. */
  includeApp?: boolean;
  /** Applied only when includeApp is true. */
  appMaxLines?: number;
  /** Override production roots for a bounded fixture or alternate host. */
  entrypoints?: readonly string[];
  /** Add intentional standalone worker/dynamic roots to the production graph. */
  reachabilityAllowlist?: readonly string[];
}

const DEFAULT_PRODUCTION_ENTRYPOINTS = ['src/main.tsx'];

// These modules are loaded by browser/extension APIs or generated tooling entrypoints,
// so their host relationship is not represented by the browser's static import graph.
const DEFAULT_REACHABILITY_ALLOWLIST = [
  // Catalog authoring/generation is hosted by scripts/catalog-operator.ts and
  // scripts/generate-starter-catalog.ts rather than src/main.tsx.
  'src/features/catalogPipeline/catalogBuilder.ts',
  'src/features/catalogPipeline/catalogEditorial.ts',
  'src/features/catalogPipeline/catalogImportPlan.ts',
  'src/features/catalogPipeline/catalogVersioning.ts',
  'src/features/catalogPipeline/pilotCatalog.ts',
  'src/features/catalogPipeline/starterCatalog.ts',
  // Release checks and migration rehearsal are standalone operator entrypoints.
  'src/features/multilingual/learningStateV3Store.ts',
  'src/features/multilingual/migrationApplication.ts',
  'src/features/multilingual/v2Migration.ts',
  'src/features/releaseReadiness/catalogPerformanceGate.ts',
  'src/features/releaseReadiness/contentReadiness.ts',
  'src/features/releaseReadiness/migrationRehearsal.ts',
  'src/features/releaseReadiness/multiScriptRelease.ts',
  'src/features/releaseReadiness/operationalReadiness.ts',
];

export function createCurrentRepoArchitectureConfig(
  rootDir: string,
  options: CurrentRepoArchitectureOptions = {},
): ArchitectureConfig {
  const includeApp = options.includeApp === true;
  return {
    rootDir,
    // Scan the complete production graph so cycles through domain/lib modules cannot hide
    // behind a presentation-only entry list. Boundary rules decide which importers are gated.
    includePaths: ['src'],
    exclude: [/\.(?:test|spec)\.[cm]?[jt]sx?$/, /\.d\.[cm]?ts$/],
    forbiddenImports: [createPresentationBoundaryRule(includeApp), createFeatureAppBoundaryRule()],
    maxLines: includeApp && options.appMaxLines !== undefined
      ? { 'src/App.tsx': options.appMaxLines }
      : {},
    entrypoints: options.entrypoints ?? DEFAULT_PRODUCTION_ENTRYPOINTS,
    reachabilityAllowlist: options.reachabilityAllowlist ?? DEFAULT_REACHABILITY_ALLOWLIST,
  };
}

export function createPresentationArchitectureConfig(
  rootDir: string,
  options: CurrentRepoArchitectureOptions = {},
): ArchitectureConfig {
  return createCurrentRepoArchitectureConfig(rootDir, options);
}
