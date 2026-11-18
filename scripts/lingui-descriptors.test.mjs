import assert from 'node:assert/strict';
import { transformSync } from '@babel/core';
import { transformSync as compileJsx } from 'esbuild';
import { formatter } from '@lingui/format-po';
const { describe, it } = process.env.VITEST ? await import('vitest') : await import('node:test');

const compileDescriptor = (environment, descriptor) => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = environment;
  try {
    const fields = Object.entries(descriptor).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join(", ");
    const { code: macroCode } = transformSync(`
      import { msg } from '@lingui/core/macro';
      const payload = { id: 'api.operation', message: 'Keep this payload unchanged' };
      const element = <Trans {...msg({ ${fields} })} values={{count: 2}} components={{strong: 'strong'}} />;
    `, {
      configFile: false, babelrc: false,
      plugins: ['@lingui/babel-plugin-lingui-macro'],
      parserOpts: { plugins: ['jsx'] },
    });
    const { code } = compileJsx(macroCode, { loader: 'jsx', jsx: 'transform' });
    return new Function('React', 'Trans', `${code}\nreturn { element, payload };`)(
      { createElement: (type, props) => ({ type, props }) }, 'Trans',
    );
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
};

describe('production translation descriptors', () => {
  it('strips only macro defaults while retaining runtime interpolation and rich-text props', () => {
    const descriptor = { id: 'cards.summary', message: '{count, plural, one {# card} other {# cards}} <strong>ready</strong>' };
    const { element, payload } = compileDescriptor('production', descriptor);
    assert.deepEqual(element.props, { id: descriptor.id, values: { count: 2 }, components: { strong: 'strong' } });
    assert.equal(payload.message, 'Keep this payload unchanged');
    assert.equal(compileDescriptor('development', descriptor).element.props.message, descriptor.message);
  });

  it('uses the native context-derived ID consistently in development and production', () => {
    const descriptor = { context: 'cards.summary', message: '{count, plural, one {# card} other {# cards}}' };
    const development = compileDescriptor('development', descriptor).element.props;
    const production = compileDescriptor('production', descriptor).element.props;
    assert.match(production.id, /^[A-Za-z0-9+/]{6}$/);
    assert.equal(production.id, development.id);
    const catalog = formatter().parse(`msgctxt ${JSON.stringify(descriptor.context)}\nmsgid ${JSON.stringify(descriptor.message)}\nmsgstr ${JSON.stringify(descriptor.message)}\n`);
    assert.equal(catalog[production.id].translation, descriptor.message);
    assert.equal(development.message, descriptor.message);
    assert.equal(production.message, undefined);
    assert.equal(production.context, undefined);
    assert.deepEqual(production.values, { count: 2 });
  });
});
