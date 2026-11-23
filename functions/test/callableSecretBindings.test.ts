import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');

// The text from `{` to its matching `}`, so an options object can be read on its own.
const balancedBlock = (text: string, open: number): string => {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1;
    if (text[index] === '}' && --depth === 0) return text.slice(open, index + 1);
  }
  throw new Error('Unbalanced block in the callable source.');
};

const callables = source.split(/^(?=export const \w+ = onCall\()/m).slice(1).map(segment => {
  const name = /^export const (\w+)/.exec(segment)![1];
  const argument = segment.slice(segment.indexOf('onCall(') + 'onCall('.length);
  const options = argument.startsWith('{')
    ? balancedBlock(argument, 0)
    : balancedBlock(source, source.indexOf('{', source.search(new RegExp(`const ${/^\w+/.exec(argument)![0]}\\b`))));
  return { name, options, segment };
});

describe('callable secret bindings', () => {
  it('finds the callables of the entry point', () => {
    expect(callables.map(callable => callable.name)).toEqual(expect.arrayContaining([
      'createCard', 'assessPronunciation', 'reviewCard', 'createSharedDeck',
    ]));
  });

  // The pseudonym key is read on every signed-in call to see whether the account is being deleted.
  // A function that does not bind it reads an empty key, and every call fails inside the hmac.
  it('binds the analytics pseudonym key in every callable that checks the signed-in user', () => {
    const unbound = callables
      .filter(callable => /\brequire(?:Profiled)?User\(/.test(callable.segment) || !callable.segment.includes('async request'))
      .filter(callable => !/secrets:\s*\[[^\]]*\banalyticsPseudonymKey\b/.test(callable.options))
      .map(callable => callable.name);
    expect(unbound).toEqual([]);
  });
});
