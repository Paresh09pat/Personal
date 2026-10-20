import js from '@eslint/js';
import globals from 'globals';
import nextVitals from 'eslint-config-next/core-web-vitals';

const WEB = ['apps/web/**/*.{js,jsx,mjs}'];

export default [
  { ignores: ['**/node_modules/**', '**/.next/**', '.data/**', '**/coverage/**', 'apps/web/next-env.d.ts'] },

  js.configs.recommended,

  // ── Node: server, shared package, root config files ────────────────────
  {
    files: ['apps/server/**/*.js', 'packages/**/*.js', '*.{js,mjs}'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.node } },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },

  // ── Isolation guard-rails for server code that handles requests/events ──
  {
    files: ['apps/server/src/features/**/*.js', 'apps/server/src/relationships/**/*.js', 'apps/server/src/realtime/**/*.js', 'apps/server/src/invitations/**/*.js'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='findById']",
          message: 'Use scoped(Model, ctx).byId() so relationshipId is always enforced.',
        },
        {
          selector: "CallExpression[callee.object.name='io'][callee.property.name='emit']",
          message: 'Never broadcast globally. Emit to a relationship/user/call room via the RealtimeHub.',
        },
        {
          selector: "CallExpression[callee.object.property.name='io'][callee.property.name='emit']",
          message: 'Never broadcast globally. Emit to a relationship/user/call room via the RealtimeHub.',
        },
      ],
    },
  },

  // ── Tests ───────────────────────────────────────────────────────────────
  {
    files: ['apps/server/test/**/*.js', 'apps/web/test/**/*.{js,jsx}'],
    languageOptions: { globals: { ...globals.node } },
  },

  // ── Next.js web app ─────────────────────────────────────────────────────
  ...nextVitals.map((c) => ({ ...c, files: c.files ? c.files.filter((f) => !f.includes('ts')).concat(WEB) : WEB })).filter((c) => c.name !== 'next/typescript'),
  {
    files: WEB,
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    settings: { next: { rootDir: 'apps/web' }, react: { version: '19.3' } },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'react/prop-types': 'off',
    },
  },
];
