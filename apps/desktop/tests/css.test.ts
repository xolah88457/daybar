import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, it } from 'vitest';

const require = createRequire(import.meta.url);
// Use Next's installed parser so stylesheet syntax is checked without adding a dependency.
const { parse } = createRequire(require.resolve('next/package.json'))('postcss') as {
  parse(css: string): unknown;
};

it('keeps the application stylesheet valid for the Next build', () => {
  const css = readFileSync(require.resolve('../src/app/globals.css'), 'utf8');
  expect(() => parse(css)).not.toThrow();
});
