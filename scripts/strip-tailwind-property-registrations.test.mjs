import { describe, expect, it } from 'vitest';
import { stripTailwindPropertyRegistrations } from './strip-tailwind-property-registrations.mjs';

describe('stripTailwindPropertyRegistrations', () => {
  it('removes optional Tailwind registrations while preserving defaults and other CSS', () => {
    const source = [
      '@layer properties{*{--tw-scale-x:1}}',
      '@property --tw-scale-x{syntax:"*";inherits:false;initial-value:1}',
      '.scale-100{--tw-scale-x:100%;transform:scaleX(var(--tw-scale-x))}',
      '@property --custom{syntax:"*";inherits:false}',
    ].join('');

    expect(stripTailwindPropertyRegistrations(source)).toBe([
      '@layer properties{*{--tw-scale-x:1}}',
      '.scale-100{--tw-scale-x:100%;transform:scaleX(var(--tw-scale-x))}',
      '@property --custom{syntax:"*";inherits:false}',
    ].join(''));
  });
});
