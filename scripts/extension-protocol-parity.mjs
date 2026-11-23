// Compares the protocol constants that the browser extension and the web app each declare for the same
// wire contract, so a change on one side alone (a storage key, a message type, a length bound) fails the
// extension check instead of silently breaking capture.

const escapeForRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const splitTopLevel = text => {
  const parts = [];
  let quote = '';
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote) quote = '';
    } else if (char === "'" || char === '"' || char === '`') {
      quote = char;
    } else if (char === ',') {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map(part => part.trim()).filter(Boolean);
};

/** Reduces a constant's initializer to a comparable string, or throws when it is not a plain literal. */
const parseLiteral = expression => {
  let value = expression.trim().replace(/\s+as const$/, '');
  const frozen = /^Object\.freeze\(([\s\S]*)\)$/.exec(value);
  if (frozen) value = frozen[1].trim().replace(/\s+as const$/, '');
  const string = /^(['"`])((?:\\.|(?!\1)[^\\])*)\1$/.exec(value);
  if (string) return JSON.stringify(string[2]);
  if (/^\d[\d_]*(?:\s*\*\s*\d[\d_]*)*$/.test(value)) {
    return String(value.split('*').reduce((product, factor) => product * Number(factor.replace(/_/g, '')), 1));
  }
  if (/^\/(?:\\.|[^/\\\n])+\/[a-z]*$/.test(value)) return value;
  const list = /^\[([\s\S]*)\]$/.exec(value);
  if (list) return `[${splitTopLevel(list[1]).map(parseLiteral).join(',')}]`;
  throw new Error(`not a plain literal: ${expression.trim()}`);
};

/** The comparable value of `const NAME = <literal>;` (optionally exported or typed) in one source file. */
export const readConstant = (source, name) => {
  const declaration = new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?const\\s+${escapeForRegExp(name)}\\b(?:\\s*:[^=\\n]+)?\\s*=\\s*([^\\n]*?);?[ \\t]*(?:\\n|$)`);
  const match = declaration.exec(source);
  if (!match) throw new Error(`${name} is not declared`);
  return parseLiteral(match[1].replace(/;\s*$/, ''));
};

/**
 * Each group names one wire value and where each side declares it: `{ label, entries: [{ file, name }] }`
 * or `{ label, entries: [{ file, pattern }] }` for a value written inline (the first capture group is the value; digits compare as numbers).
 * Add `literal: true` to read the capture as a plain literal, so an inline list or regex compares like a declared constant.
 * A global `pattern` compares every match in the file, so a value repeated inline cannot drift within one file.
 * Returns one message per group whose sides disagree or cannot be read.
 */
export const findProtocolDrift = (sources, groups) => {
  const problems = [];
  for (const group of groups) {
    const values = [];
    for (const entry of group.entries) {
      const source = sources[entry.file];
      const where = `${entry.file}${entry.name ? ` ${entry.name}` : ''}`;
      if (source === undefined) {
        problems.push(`${group.label}: ${entry.file} was not read.`);
        continue;
      }
      try {
        if (entry.pattern) {
          const matches = entry.pattern.global ? [...source.matchAll(entry.pattern)] : [entry.pattern.exec(source)].filter(Boolean);
          if (!matches.length) throw new Error('pattern did not match');
          for (const match of matches) {
            const value = entry.literal
              ? parseLiteral(match[1])
              : /^\d+$/.test(match[1]) ? String(Number(match[1])) : JSON.stringify(match[1]);
            values.push({ where, value });
          }
        } else {
          values.push({ where, value: readConstant(source, entry.name) });
        }
      } catch (error) {
        problems.push(`${group.label}: cannot read ${where} (${error instanceof Error ? error.message : error}).`);
      }
    }
    if (new Set(values.map(entry => entry.value)).size > 1) {
      problems.push(`${group.label} differs: ${values.map(entry => `${entry.where} = ${entry.value}`).join('; ')}.`);
    }
  }
  return problems;
};
