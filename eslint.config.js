// Config ESLint partagée : server/, customer-web/, staff-app/.
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/',
      '**/dist/',
      '**/build/',
      '**/coverage/',
      '**/.venv/',
    ],
  },

  // Base commune
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
    },
  },

  // Serveur : Node + règles qui utilisent les types (promesses oubliées, etc.)
  {
    files: ['server/**/*.ts'],
    extends: [...tseslint.configs.strictTypeChecked],
    languageOptions: {
      globals: globals.node,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },

  // Apps React (navigateur)
  {
    files: ['customer-web/**/*.{ts,tsx}', 'staff-app/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    languageOptions: { globals: globals.browser },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // Fichiers de config et scripts en JS (ce fichier, vite.config, scripts/*.mjs...)
  {
    files: ['**/*.js', 'scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },

  // Service worker de l'app staff (installation, notifications push)
  {
    files: ['staff-app/public/sw.js'],
    languageOptions: { globals: globals.serviceworker },
  },
);
