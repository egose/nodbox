// @ts-check

import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import eslintConfigPrettier from 'eslint-config-prettier';

export default defineConfig(
  {
    ignores: ['**/node_modules/**'],
  },
  eslint.configs.recommended,
  eslintConfigPrettier,
  {
    rules: {
      'no-undef': 'off',
    },
  },
);
