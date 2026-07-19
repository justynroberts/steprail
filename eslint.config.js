// MIT License - Copyright (c) fintonlabs.com
// Flat ESLint config. tsc already enforces types; ESLint catches the class of
// bugs types don't — unused bindings, hook misuse, accidental globals, `var`.
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'cli/**', '.playwright-mcp/**', '*.config.*'] },

  // Browser + TS/JSX (the app).
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-var': 'error',
      'prefer-const': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // The codebase uses `any` intentionally at a few dynamic boundaries.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // Node ESM (server + shared + tests) — plain JS, no type-checking.
  {
    files: ['server/**/*.mjs', 'shared/**/*.mjs', 'tests/**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: { globals: { ...globals.node }, ecmaVersion: 2023, sourceType: 'module' },
    rules: {
      'no-var': 'error',
      'prefer-const': 'warn',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
)
