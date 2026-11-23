import type { Messages } from '@lingui/core';

const stretch = (text: string): string => text + '·'.repeat(Math.ceil([...text].length * 0.35));

// Lingui supplies the accents; this adds visible width and brackets for layout checks.
const expandParts = (parts: unknown[]): unknown[] => parts.map(part => {
  if (typeof part === 'string') return stretch(part);
  if (!Array.isArray(part)) return part;
  if (part.length === 1 && typeof part[0] === 'string') return part;
  if (typeof part[0] === 'string' && ['plural', 'select', 'selectordinal'].includes(part[1])) {
    const options = Object.fromEntries(Object.entries(part[2] as Record<string, unknown[]>).map(
      ([key, branch]) => [key, expandParts(branch)],
    ));
    return [part[0], part[1], options, ...part.slice(3)];
  }
  return part;
});

export const expandPseudoCatalog = (messages: Messages): Messages => Object.fromEntries(
  Object.entries(messages).map(([id, message]) => {
    if (typeof message === 'string') return [id, `[${stretch(message)}]`];
    if (Array.isArray(message)) {
      return [id, ['[', ...expandParts(message), ']']];
    }
    return [id, message];
  }),
) as Messages;
