import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(new URL('./index.css', import.meta.url), 'utf8');

const themeDeclarations = (selector: ':root' | ':root.dark') => {
  const match = stylesheet.match(
    selector === ':root' ? /:root\s*\{([^}]*)\}/ : /:root\.dark\s*\{([^}]*)\}/,
  );
  if (!match) throw new Error(`Missing ${selector} theme declarations.`);
  return match[1];
};

describe('surface theme tokens', () => {
  it('defines the muted surface token for light and dark themes', () => {
    expect(themeDeclarations(':root')).toMatch(/--sf-surface-muted\s*:/);
    expect(themeDeclarations(':root.dark')).toMatch(/--sf-surface-muted\s*:/);
  });
});
