# Quality

Maintained by [ever-better](https://github.com/isamu/ever-better). Numbers are rendered from
`.ever-better/state.json`; edits outside the notes block are overwritten on the next run.

- Phase: **drain**
- Frozen: 2026-10-16T21:27:09.287Z
- Open violations: **383**
- Rules improved since the ceiling: **0**
- Everything is at or below its ceiling.

## Worklist

Top to bottom. An unattended run works this list and nothing else.

- [x] **P0 diagnose** — taken 2026-10-16T21:17:35.235Z
- [ ] **P1 bootstrap** — 1 gap(s) still open
- [x] **P2 freeze** — frozen 2026-10-16T21:27:09.287Z
- [ ] **P3 drain** — 383 violations across 36 rules
  - [ ] `sonarjs/no-os-command-from-path` — 1 left
  - [ ] `@typescript-eslint/consistent-type-definitions` — 1 left
  - [ ] `sonarjs/reduce-initial-value` — 1 left
  - [ ] `@typescript-eslint/no-unsafe-return` — 1 left
  - [ ] `@typescript-eslint/prefer-optional-chain` — 1 left
- [ ] **P4 tighten** — add the next rule tier, then freeze and drain again
- [ ] **P5 duplication and dead code** — report-only scans; extraction is judgment, not a threshold

## Ratchet

Ceiling is the count at the last freeze. It may fall and must never rise.

| Rule | Ceiling | Now | Change | Status |
| --- | ---: | ---: | ---: | --- |
| `@typescript-eslint/no-unsafe-member-access` | 61 | 61 | 0 | draining |
| `@typescript-eslint/restrict-template-expressions` | 60 | 60 | 0 | draining |
| `@typescript-eslint/no-non-null-assertion` | 52 | 52 | 0 | draining |
| `@typescript-eslint/consistent-type-assertions` | 46 | 46 | 0 | draining |
| `@typescript-eslint/no-unnecessary-type-assertion` | 31 | 31 | 0 | draining |
| `@typescript-eslint/no-unsafe-assignment` | 14 | 14 | 0 | draining |
| `@typescript-eslint/no-unnecessary-condition` | 13 | 13 | 0 | draining |
| `sonarjs/no-nested-template-literals` | 12 | 12 | 0 | draining |
| `@typescript-eslint/no-explicit-any` | 12 | 12 | 0 | draining |
| `sonarjs/no-nested-conditional` | 8 | 8 | 0 | draining |
| `@typescript-eslint/prefer-nullish-coalescing` | 7 | 7 | 0 | draining |
| `@typescript-eslint/no-unsafe-argument` | 7 | 7 | 0 | draining |
| `@typescript-eslint/no-unsafe-call` | 7 | 7 | 0 | draining |
| `sonarjs/cognitive-complexity` | 6 | 6 | 0 | draining |
| `complexity` | 5 | 5 | 0 | draining |
| `sonarjs/no-alphabetical-sort` | 5 | 5 | 0 | draining |
| `@typescript-eslint/require-await` | 5 | 5 | 0 | draining |
| `@typescript-eslint/no-base-to-string` | 4 | 4 | 0 | draining |
| `sonarjs/regex-complexity` | 3 | 3 | 0 | draining |
| `@typescript-eslint/no-unnecessary-type-arguments` | 3 | 3 | 0 | draining |
| `@typescript-eslint/no-empty-function` | 3 | 3 | 0 | draining |
| `sonarjs/super-linear-regex` | 2 | 2 | 0 | draining |
| `max-lines-per-function` | 2 | 2 | 0 | draining |
| `@typescript-eslint/no-confusing-void-expression` | 2 | 2 | 0 | draining |
| `@typescript-eslint/no-invalid-void-type` | 2 | 2 | 0 | draining |
| `sonarjs/no-os-command-from-path` | 1 | 1 | 0 | draining |
| `@typescript-eslint/consistent-type-definitions` | 1 | 1 | 0 | draining |
| `sonarjs/reduce-initial-value` | 1 | 1 | 0 | draining |
| `@typescript-eslint/no-unsafe-return` | 1 | 1 | 0 | draining |
| `@typescript-eslint/prefer-optional-chain` | 1 | 1 | 0 | draining |
| `@typescript-eslint/no-floating-promises` | 1 | 1 | 0 | draining |
| `max-lines` | 1 | 1 | 0 | draining |
| `@typescript-eslint/no-unused-vars` | 1 | 1 | 0 | draining |
| `sonarjs/unused-import` | 1 | 1 | 0 | draining |
| `sonarjs/different-types-comparison` | 1 | 1 | 0 | draining |
| `@typescript-eslint/restrict-plus-operands` | 1 | 1 | 0 | draining |

## Other counters

| Counter | Ceiling | Now |
| --- | ---: | ---: |
| eslint:warnings | 2 | 2 |

## Outstanding

### bootstrap

- [ ] **No test runner** — Draining warnings finds bugs. Without a runner there is nowhere to pin them.

### tighten

- [ ] **Only 66% of sources are TypeScript** — The type-aware rules cover the typed part only, so the remaining .js files are the blind spot the counts will not show.
- [ ] **No dead-code detection** — knip reports unused exports and files. Report-only at first; a counter later.
- [ ] **6 strictness flags `strict` does not include are off** — Measured with `tsc --showConfig`, after every extends: noUncheckedIndexedAccess, exactOptionalPropertyTypes, noImplicitReturns, noFallthroughCasesInSwitch, noImplicitOverride, noPropertyAccessFromIndexSignature. Type errors have no suppression mechanism, so enable them one at a time and measure the cost first.

### split

- [ ] **No duplication detection** — jscpd is what turns 'this feels repetitive' into a number that can only go down.
- [ ] **2 files over 600 lines** — These are the split-and-DRY backlog. Knowing the count now makes the limit a choice.

### review

- [ ] **CI does not run on macos, windows** — Path handling and file watching break per platform, and only per platform.
- [ ] **CI does not run lint** — The rules are configured but nothing runs them on a pull request.
- [ ] **CI does not run `ever-better check`** — A baseline is only a ratchet if something rejects a regression. Thorough CI that never runs the gate enforces nothing, and looks identical from the outside.

## Notes

<!-- ever-better:notes:start -->
_Anything written between these markers survives a re-render._
<!-- ever-better:notes:end -->
