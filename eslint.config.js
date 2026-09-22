import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import stylistic from '@stylistic/eslint-plugin';

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'release/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, '@stylistic': stylistic },
    rules: {
      // Match the conventions the Fuse web app used: the two classic hook
      // rules, not the React Compiler-era lints that reject ref reads during
      // render in the ported scroll choreography.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@stylistic/semi': ['error', 'always'],
      '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // The web app's lint config allows these; the ported code relies on them.
      '@typescript-eslint/no-explicit-any': 'off',
      'no-useless-escape': 'off',
      'no-constant-binary-expression': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
);
