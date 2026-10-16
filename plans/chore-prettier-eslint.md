# Prettier and ESLint (#11)

Generated with `ever-better bootstrap`, taking only the formatter, ESLint, the scripts and the
secret scan. Left out: the baseline freeze, knip / jscpd, vitest (the repo uses `node --test`),
dependabot, the Codex review workflow, and a win/mac CI matrix.

## PR 1 — Prettier

- `prettier` devDependency, `.prettierrc.json` (`printWidth: 160`, the existing line length),
  `.prettierignore` (`dist/`, `yarn.lock`; git-ignored files are skipped by Prettier already).
- `format` / `format:check` scripts; CI runs `format:check`.
- `yarn format` over every file, in its own commit.
- Evidence it is mechanical: the parsed quiz JSON and `src/quizzes.gen.ts` are byte-identical
  before and after; `wrangler deploy --dry-run` reads the reformatted `wrangler.jsonc` (now with
  trailing commas; `scripts/env.mjs` edits it by regex); typecheck, unit, plugin and API tests
  pass; the page plays every quiz to a result in Chrome.

## PR 2 — ESLint and secret scan

- ESLint flat config from ever-better (typescript-eslint strictTypeChecked + stylistic, sonarjs,
  security, vue, prettier), `lint` script.
- gitleaks secret-scan workflow.
- The generated config uses the project service, which finds only `tsconfig.json`; the plugin's
  `.vue` files live in `tsconfig.plugin.json`. It lists both tsconfigs instead, and turns the
  type-aware rules off for `.js` / `.mjs` / `*.config.ts`, which no tsconfig covers.
- Generated, git-ignored files (`src/quizzes.gen.ts`, `public/game.js`,
  `worker-configuration.d.ts`) are ignored, not linted.
- Lint is not gated in CI yet: without a frozen baseline every existing violation would fail it.
