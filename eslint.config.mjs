import js from '@eslint/js';
import ts from 'typescript-eslint';
export default ts.config(
  { ignores: ['legacy/**', 'scriptable/**', '**/out/**', '**/.next/**', '**/target/**', '.worktrees/**', '.claude/worktrees/**', '**/next-env.d.ts'] },
  js.configs.recommended, ...ts.configs.recommended,
  { files: ['**/*.{ts,tsx,mjs}'], languageOptions: { globals: { console: 'readonly' } } },
  // Playwright recording script: CommonJS in Node, with callbacks that run inside the page.
  {
    files: ['docs/screenshots/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: { require: 'readonly', process: 'readonly', __dirname: 'readonly', console: 'readonly', window: 'readonly', document: 'readonly', addEventListener: 'readonly', setTimeout: 'readonly' } },
    rules: { '@typescript-eslint/no-require-imports': 'off' }
  }
);
