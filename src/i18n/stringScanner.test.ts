import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { migratedFiles } from './migratedFiles';

const userTextAttributes = new Set(['aria-label', 'title', 'placeholder', 'alt']);
const allowedLiterals = new Set(['SonFlash', 'English', 'Tiếng Việt']);

const isVisibleLiteral = (value: string) => {
  const text = value.trim();
  return /[\p{L}]/u.test(text) && !allowedLiterals.has(text);
};

const scan = (source: string, file: string): string[] => {
  const syntax = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const violations: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node) && isVisibleLiteral(node.getText(syntax))) {
      violations.push(`JSX text: ${node.getText(syntax).trim()}`);
    }
    if (ts.isJsxAttribute(node) && userTextAttributes.has(node.name.getText(syntax))) {
      const initializer = node.initializer;
      const literal = initializer && ts.isStringLiteral(initializer)
        ? initializer
        : initializer && ts.isJsxExpression(initializer) && initializer.expression
          && (ts.isStringLiteral(initializer.expression) || ts.isNoSubstitutionTemplateLiteral(initializer.expression))
          ? initializer.expression : null;
      if (literal && isVisibleLiteral(literal.text)) {
        violations.push(`${node.name.getText(syntax)}: ${literal.text}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(syntax);
  return violations;
};

describe('migrated UI string guard', () => {
  it('detects visible JSX and accessibility literals while allowing noncopy values', () => {
    expect(scan('<main><h1>Today</h1><img alt="Study card" title={"Hard word"} aria-label={`Read aloud`} /><span aria-hidden="true">★</span></main>', 'sample.tsx'))
      .toEqual(['JSX text: Today', 'alt: Study card', 'title: Hard word', 'aria-label: Read aloud']);
  });

  it.each(migratedFiles)('%s has no hardcoded user-visible strings', file => {
    expect(scan(readFileSync(resolve(file), 'utf8'), file)).toEqual([]);
  });
});
