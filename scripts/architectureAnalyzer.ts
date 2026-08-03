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
}

export interface ArchitectureConfig {
  rootDir: string;
  includePaths: readonly string[];
  exclude?: readonly RegExp[];
  forbiddenImports?: readonly ForbiddenImportRule[];
  maxLines: Readonly<Record<string, number>>;
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
  };

export interface ArchitectureReport {
  modules: ModuleSizeReport[];
  cycles: string[][];
  violations: ArchitectureViolation[];
}

interface ParsedImport {
  path: string;
  line: number;
}

const TYPESCRIPT_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'];

const normalizeFile = (file: string): string => file.replaceAll('\\', '/').replace(/^\.\//, '');

const matches = (pattern: RegExp, value: string): boolean => {
  pattern.lastIndex = 0;
  return pattern.test(value);
};

const scriptKindFor = (file: string): ts.ScriptKind =>
  file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;

const parseImports = (file: string, source: string): { sourceFile: ts.SourceFile; imports: ParsedImport[] } => {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(file),
  );
  const imports: ParsedImport[] = [];
  const add = (node: ts.Node, value: ts.Expression | undefined) => {
    if (!value || !ts.isStringLiteralLike(value)) return;
    imports.push({
      path: value.text,
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      add(node, node.moduleSpecifier);
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

export function analyzeSourceModules({
  sources,
  forbiddenImports = [],
  maxLines = {},
}: SourceArchitectureInput): ArchitectureReport {
  const normalizedSources = new Map(
    Object.entries(sources).map(([file, source]) => [normalizeFile(file), source]),
  );
  const files = new Set(normalizedSources.keys());
  const graph = new Map<string, string[]>();
  const modules: ModuleSizeReport[] = [];
  const violations: ArchitectureViolation[] = [];

  for (const [file, source] of [...normalizedSources.entries()].sort(([left], [right]) =>
    left.localeCompare(right))) {
    const parsed = parseImports(file, source);
    const dependencies = parsed.imports.flatMap(item => {
      const resolved = resolveRelativeImport(file, item.path, files);
      return resolved ? [resolved] : [];
    });
    graph.set(file, [...new Set(dependencies)].sort());
    modules.push({
      file,
      lineCount: parsed.sourceFile.getLineStarts().length,
      imports: parsed.imports.map(item => item.path),
    });

    for (const item of parsed.imports) {
      for (const rule of forbiddenImports) {
        if (matches(rule.from, file) && matches(rule.imports, item.path)) {
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

  return { modules, cycles: findCycles(graph), violations };
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
  });
}

const PRESENTATION_BOUNDARY: ForbiddenImportRule = {
  name: 'presentation-must-use-domain-ports',
  from: /^(?:src\/App\.tsx|src\/(?:components|presentation)\/)/,
  imports: /^(?:firebase(?:\/|$)|.*(?:^|\/)[^/]*(?:Repository|repository)(?:\.[^/]*)?)$/,
};

export function createPresentationArchitectureConfig(
  rootDir: string,
  options: { includeApp?: boolean; appMaxLines?: number } = {},
): ArchitectureConfig {
  const includeApp = options.includeApp === true;
  return {
    rootDir,
    includePaths: includeApp
      ? ['src/components', 'src/App.tsx']
      : ['src/components'],
    exclude: [/\.(?:test|spec)\.[cm]?[jt]sx?$/, /\.d\.[cm]?ts$/],
    forbiddenImports: [PRESENTATION_BOUNDARY],
    maxLines: includeApp && options.appMaxLines !== undefined
      ? { 'src/App.tsx': options.appMaxLines }
      : {},
  };
}
