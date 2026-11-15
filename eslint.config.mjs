import js from '@eslint/js';
import ts from 'typescript-eslint';
export default ts.config(
  { ignores: ['legacy/**', 'scriptable/**', '**/out/**', '**/.next/**', '**/target/**', '.worktrees/**', '**/next-env.d.ts'] },
  js.configs.recommended, ...ts.configs.recommended,
  { files: ['**/*.{ts,tsx,mjs}'], languageOptions: { globals: { process: 'readonly', console: 'readonly', window: 'readonly', document: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly', ResizeObserver: 'readonly', navigator: 'readonly', structuredClone: 'readonly' } } }
);
